import { randomBytes, randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import {
  addPlayer,
  createLobby,
  makeSeatPlayer,
  placeStone,
  quitMatch,
  remainingMs,
  startMatch,
  tick,
  type MatchState,
} from "../src/engine/index.ts";
import { parseClientMessage, type ServerMessage } from "../src/protocol.ts";

const HOST = "127.0.0.1";
const PORT = Number(process.env.GOMOKU_WS_PORT ?? 18765);

type Room = {
  id: string;
  match: MatchState;
  clients: Map<string, WebSocket>;
};

type SocketData = {
  playerId: string;
  roomId: string | null;
};

const rooms = new Map<string, Room>();
const sockets = new WeakMap<WebSocket, SocketData>();

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function now(): number {
  return Date.now();
}

function roomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(6);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

function syncRoom(room: Room): void {
  room.match = tick(room.match, now());
  for (const [playerId, ws] of room.clients) {
    send(ws, {
      type: "state",
      roomId: room.id,
      playerId,
      remainingMs: remainingMs(room.match, now()),
      match: room.match,
    });
  }
}

function leave(ws: WebSocket): void {
  const data = sockets.get(ws);
  if (!data?.roomId) return;
  const room = rooms.get(data.roomId);
  if (!room) return;
  if (room.match.status === "playing" || room.match.status === "lobby") {
    room.match = quitMatch(room.match, data.playerId);
  }
  syncRoom(room);
  room.clients.delete(data.playerId);
  data.roomId = null;
  if (room.clients.size === 0) {
    rooms.delete(room.id);
  }
}

const wss = new WebSocketServer({ host: HOST, port: PORT });

wss.on("connection", (ws) => {
  const playerId = randomUUID();
  sockets.set(ws, { playerId, roomId: null });

  ws.on("message", (raw) => {
    try {
      const msg = parseClientMessage(String(raw));
      const data = sockets.get(ws);
      if (!data) return;

      if (msg.type === "create") {
        if (data.roomId) throw new Error("已在房间中");
        let id = roomCode();
        while (rooms.has(id)) id = roomCode();
        const match = addPlayer(createLobby(msg.capacity), makeSeatPlayer(0, playerId));
        const room: Room = { id, match, clients: new Map([[playerId, ws]]) };
        rooms.set(id, room);
        data.roomId = id;
        syncRoom(room);
        return;
      }

      if (msg.type === "join") {
        if (data.roomId) throw new Error("已在房间中");
        const room = rooms.get(msg.roomId.trim().toUpperCase());
        if (!room) throw new Error("房间不存在");
        const seat = room.match.players.length;
        room.match = addPlayer(room.match, makeSeatPlayer(seat, playerId));
        room.clients.set(playerId, ws);
        data.roomId = room.id;
        syncRoom(room);
        return;
      }

      const room = data.roomId ? rooms.get(data.roomId) : undefined;
      if (!room) throw new Error("尚未加入房间");

      if (msg.type === "start") {
        room.match = startMatch(room.match, now(), Math.random);
        syncRoom(room);
        return;
      }

      if (msg.type === "place") {
        room.match = placeStone(room.match, playerId, msg.x, msg.y, now());
        syncRoom(room);
        return;
      }

      if (msg.type === "quit") {
        leave(ws);
      }
    } catch (err) {
      send(ws, { type: "error", message: err instanceof Error ? err.message : "操作失败" });
    }
  });

  ws.on("close", () => leave(ws));
});

setInterval(() => {
  for (const room of rooms.values()) {
    if (room.match.status !== "playing") continue;
    const before = room.match.consecutiveTimeouts;
    const current = room.match.currentPlayerId;
    const status = room.match.status;
    room.match = tick(room.match, now());
    if (
      room.match.consecutiveTimeouts !== before ||
      room.match.currentPlayerId !== current ||
      room.match.status !== status
    ) {
      syncRoom(room);
    }
  }
}, 50);

console.log(`gomoku local ws ws://${HOST}:${PORT}`);
