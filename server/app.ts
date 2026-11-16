import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import {
  abortForReconnectTimeout,
  addPlayer,
  createLobby,
  isFinished,
  makeSeatPlayer,
  placeStone,
  quitMatch,
  remainingMs,
  setReady,
  startMatch,
  tick,
  tryStartRematch,
  type MatchState,
} from "../src/engine/index.ts";
import {
  parseClientMessage,
  type SeatPresence,
  type ServerMessage,
} from "../src/protocol.ts";
import { loadConfig, type GomokuConfig } from "./config.ts";
import { originAllowed } from "./origin.ts";
import { SlidingWindowLimiter } from "./rateLimit.ts";

type Seat = {
  playerId: string;
  sessionToken: string;
  ws: WebSocket | null;
  disconnectedAt: number | null;
};

type Room = {
  id: string;
  match: MatchState;
  seats: Map<string, Seat>;
  lastActiveAt: number;
};

type SocketData = {
  ip: string;
  playerId: string | null;
  roomId: string | null;
  sessionToken: string | null;
  replaced: boolean;
  closedByServer: boolean;
};

export type GomokuServer = {
  config: GomokuConfig;
  httpServer: Server;
  listen: (port?: number) => Promise<number>;
  close: () => Promise<void>;
  tickOnce: () => void;
  roomCount: () => number;
  connectionCount: () => number;
};

const ROOM_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function roomCode(): string {
  const bytes = randomBytes(6);
  return Array.from(bytes, (b) => ROOM_CHARS[b % ROOM_CHARS.length]).join("");
}

function sessionToken(): string {
  return randomBytes(32).toString("hex");
}

function clientIp(req: IncomingMessage): string {
  const remote = req.socket.remoteAddress ?? "unknown";
  const loopback =
    remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
  if (!loopback) return remote;
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.trim()) {
    return xff.split(",")[0]!.trim();
  }
  return remote;
}

function isWsPath(url: string | undefined): boolean {
  const path = (url ?? "/").split("?")[0];
  return path === "/" || path === "/ws";
}

export function createGomokuServer(overrides: Partial<GomokuConfig> = {}): GomokuServer {
  const config: GomokuConfig = { ...loadConfig(), ...overrides };
  const rooms = new Map<string, Room>();
  const tokens = new Map<string, { roomId: string; playerId: string }>();
  const sockets = new WeakMap<WebSocket, SocketData>();
  const liveSockets = new Set<WebSocket>();
  const connectLimit = new SlidingWindowLimiter(config.connectPerMinute, 60_000, config.now);
  const createLimit = new SlidingWindowLimiter(config.createPerMinute, 60_000, config.now);
  const messageLimit = new SlidingWindowLimiter(config.messagesPerSecond, 1_000, config.now);
  let connectionCount = 0;
  let closing = false;

  const httpServer = createServer((req, res) => {
    if (req.method === "GET" && req.url?.split("?")[0] === "/health") {
      const body = JSON.stringify({
        ok: true,
        rooms: rooms.size,
        connections: connectionCount,
      });
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(body);
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: config.maxMessageBytes });

  function presenceOf(room: Room): SeatPresence[] {
    return [...room.seats.values()].map((seat) => ({
      playerId: seat.playerId,
      online: seat.ws != null && seat.ws.readyState === seat.ws.OPEN,
      reconnectDeadlineMs:
        seat.disconnectedAt == null ? null : seat.disconnectedAt + config.reconnectGraceMs,
    }));
  }

  function syncRoom(room: Room): void {
    room.match = tick(room.match, config.now());
    room.lastActiveAt = config.now();
    const presence = presenceOf(room);
    for (const seat of room.seats.values()) {
      if (!seat.ws || seat.ws.readyState !== seat.ws.OPEN) continue;
      send(seat.ws, {
        type: "state",
        roomId: room.id,
        playerId: seat.playerId,
        sessionToken: seat.sessionToken,
        remainingMs: remainingMs(room.match, config.now()),
        reconnectGraceMs: config.reconnectGraceMs,
        match: room.match,
        presence,
      });
    }
  }

  function deleteRoom(room: Room): void {
    for (const seat of room.seats.values()) {
      tokens.delete(seat.sessionToken);
    }
    rooms.delete(room.id);
  }

  function detachSeat(room: Room, playerId: string): void {
    const seat = room.seats.get(playerId);
    if (!seat) return;
    tokens.delete(seat.sessionToken);
    room.seats.delete(playerId);
  }

  function dropDisconnectedSeat(room: Room, playerId: string): void {
    if (room.match.status === "playing") {
      room.match = abortForReconnectTimeout(room.match, playerId);
    } else {
      room.match = quitMatch(room.match, playerId);
    }
    detachSeat(room, playerId);
    if (room.seats.size === 0) {
      deleteRoom(room);
      return;
    }
    syncRoom(room);
  }

  function bindSocket(ws: WebSocket, data: SocketData, room: Room, seat: Seat): void {
    data.playerId = seat.playerId;
    data.roomId = room.id;
    data.sessionToken = seat.sessionToken;
    seat.ws = ws;
    seat.disconnectedAt = null;
    room.seats.set(seat.playerId, seat);
    tokens.set(seat.sessionToken, { roomId: room.id, playerId: seat.playerId });
  }

  function rawToString(raw: WebSocket.RawData): string {
    if (typeof raw === "string") return raw;
    if (Array.isArray(raw)) return Buffer.concat(raw).toString("utf8");
    if (Buffer.isBuffer(raw)) return raw.toString("utf8");
    return Buffer.from(new Uint8Array(raw)).toString("utf8");
  }

  function handleMessage(ws: WebSocket, raw: WebSocket.RawData): void {
    const data = sockets.get(ws);
    if (!data) return;
    const text = rawToString(raw);

    try {
      if (!messageLimit.try(data.ip)) {
        throw new Error("操作过于频繁");
      }
      const msg = parseClientMessage(text, config.maxMessageBytes);

      if (msg.type === "create") {
        if (data.roomId) throw new Error("已在房间中");
        if (rooms.size >= config.maxRooms) throw new Error("房间已满员，请稍后再试");
        if (!createLimit.try(data.ip)) throw new Error("建房过于频繁");
        let id = roomCode();
        while (rooms.has(id)) id = roomCode();
        const playerId = randomUUID();
        const token = sessionToken();
        const match = addPlayer(createLobby(msg.capacity), makeSeatPlayer(0, playerId));
        const seat: Seat = { playerId, sessionToken: token, ws, disconnectedAt: null };
        const room: Room = { id, match, seats: new Map([[playerId, seat]]), lastActiveAt: config.now() };
        rooms.set(id, room);
        bindSocket(ws, data, room, seat);
        config.log("room_create", { roomId: id, capacity: msg.capacity });
        syncRoom(room);
        return;
      }

      if (msg.type === "join") {
        if (data.roomId) throw new Error("已在房间中");
        const room = rooms.get(msg.roomId);
        if (!room) throw new Error("房间不存在");
        const playerId = randomUUID();
        const token = sessionToken();
        const seatIndex = room.match.players.length;
        room.match = addPlayer(room.match, makeSeatPlayer(seatIndex, playerId));
        const seat: Seat = { playerId, sessionToken: token, ws, disconnectedAt: null };
        bindSocket(ws, data, room, seat);
        syncRoom(room);
        return;
      }

      if (msg.type === "resume") {
        const found = tokens.get(msg.sessionToken);
        if (!found) throw new Error("会话无效或已过期");
        const room = rooms.get(found.roomId);
        const seat = room?.seats.get(found.playerId);
        if (!room || !seat || seat.sessionToken !== msg.sessionToken) {
          throw new Error("会话无效或已过期");
        }
        if (data.roomId && data.roomId !== room.id) throw new Error("已在房间中");
        if (seat.ws && seat.ws !== ws) {
          const old = sockets.get(seat.ws);
          if (old) old.replaced = true;
          seat.ws.close();
        }
        bindSocket(ws, data, room, seat);
        syncRoom(room);
        return;
      }

      const room = data.roomId ? rooms.get(data.roomId) : undefined;
      if (!room || !data.playerId) throw new Error("尚未加入房间");
      const seat = room.seats.get(data.playerId);
      if (!seat || seat.ws !== ws) throw new Error("座位未绑定");

      if (msg.type === "start") {
        room.match = startMatch(room.match, config.now(), config.rng);
        syncRoom(room);
        return;
      }

      if (msg.type === "place") {
        room.match = placeStone(room.match, data.playerId, msg.x, msg.y, config.now());
        syncRoom(room);
        return;
      }

      if (msg.type === "ready") {
        room.match = setReady(room.match, data.playerId, msg.ready);
        if (
          isFinished(room.match.status) &&
          room.match.players.length === room.match.capacity &&
          room.match.players.every((p) => room.match.readyIds.includes(p.id))
        ) {
          room.match = tryStartRematch(room.match, config.now(), config.rng);
        }
        syncRoom(room);
        return;
      }

      if (msg.type === "quit") {
        room.match = quitMatch(room.match, data.playerId);
        detachSeat(room, data.playerId);
        data.roomId = null;
        data.playerId = null;
        data.sessionToken = null;
        if (room.seats.size === 0) {
          deleteRoom(room);
          return;
        }
        syncRoom(room);
      }
    } catch (err) {
      send(ws, { type: "error", message: err instanceof Error ? err.message : "操作失败" });
    }
  }

  function onSocketClose(ws: WebSocket): void {
    liveSockets.delete(ws);
    const data = sockets.get(ws);
    if (!data) return;
    connectionCount = Math.max(0, connectionCount - 1);
    if (data.replaced || data.closedByServer || closing) return;
    if (!data.roomId || !data.playerId) return;
    const room = rooms.get(data.roomId);
    const seat = room?.seats.get(data.playerId);
    if (!room || !seat || seat.ws !== ws) return;
    seat.ws = null;
    seat.disconnectedAt = config.now();
    syncRoom(room);
  }

  wss.on("connection", (ws, req) => {
    const ip = clientIp(req);
    liveSockets.add(ws);
    sockets.set(ws, {
      ip,
      playerId: null,
      roomId: null,
      sessionToken: null,
      replaced: false,
      closedByServer: false,
    });
    connectionCount += 1;
    ws.on("message", (raw) => handleMessage(ws, raw));
    ws.on("close", () => onSocketClose(ws));
    ws.on("error", () => {
      /* close handler follows */
    });
  });

  httpServer.on("upgrade", (req, socket, head) => {
    if (closing) {
      socket.destroy();
      return;
    }
    if (!isWsPath(req.url)) {
      socket.destroy();
      return;
    }
    const originHeader = req.headers.origin;
    const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
    if (!originAllowed(origin, config)) {
      config.log("ws_origin_reject", { origin: origin ?? "" });
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    if (connectionCount >= config.maxConnections) {
      socket.write("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    const ip = clientIp(req);
    if (!connectLimit.try(ip)) {
      socket.write("HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  function tickOnce(): void {
    const now = config.now();
    connectLimit.prune();
    createLimit.prune();
    messageLimit.prune();
    for (const room of [...rooms.values()]) {
      if (room.match.status === "playing") {
        const before = room.match.consecutiveTimeouts;
        const current = room.match.currentPlayerId;
        const status = room.match.status;
        room.match = tick(room.match, now);
        if (
          room.match.consecutiveTimeouts !== before ||
          room.match.currentPlayerId !== current ||
          room.match.status !== status
        ) {
          syncRoom(room);
        }
      }

      for (const seat of [...room.seats.values()]) {
        if (seat.disconnectedAt == null) continue;
        if (now - seat.disconnectedAt < config.reconnectGraceMs) continue;
        const still = rooms.get(room.id);
        if (!still) break;
        dropDisconnectedSeat(still, seat.playerId);
      }

      const live = rooms.get(room.id);
      if (!live) continue;
      const idleFor = now - live.lastActiveAt;
      const emptyish = live.seats.size === 0;
      const lobbyIdle = live.match.status === "lobby" && idleFor >= config.idleLobbyMs;
      const finishedIdle = isFinished(live.match.status) && idleFor >= config.idleFinishedMs;
      if (emptyish || lobbyIdle || finishedIdle) {
        config.log("room_idle_cleanup", { roomId: live.id, status: live.match.status });
        for (const seat of live.seats.values()) {
          if (seat.ws) {
            const data = sockets.get(seat.ws);
            if (data) data.closedByServer = true;
            seat.ws.close();
          }
        }
        deleteRoom(live);
      }
    }
  }

  let timer: ReturnType<typeof setInterval> | null = null;

  async function listen(port = config.port): Promise<number> {
    await new Promise<void>((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(port, config.host, () => {
        httpServer.off("error", reject);
        resolve();
      });
    });
    timer = setInterval(tickOnce, config.tickMs);
    timer.unref?.();
    const address = httpServer.address();
    const bound = typeof address === "object" && address ? address.port : port;
    config.log("listen", { host: config.host, port: bound });
    return bound;
  }

  async function close(): Promise<void> {
    closing = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    for (const room of rooms.values()) {
      for (const seat of room.seats.values()) {
        if (seat.ws) {
          const data = sockets.get(seat.ws);
          if (data) data.closedByServer = true;
          seat.ws.close();
        }
      }
    }
    rooms.clear();
    tokens.clear();
    for (const ws of liveSockets) {
      const data = sockets.get(ws);
      if (data) data.closedByServer = true;
      ws.terminate();
    }
    liveSockets.clear();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve, reject) => {
      httpServer.close((err) => (err ? reject(err) : resolve()));
    });
  }

  return {
    config,
    httpServer,
    listen,
    close,
    tickOnce,
    roomCount: () => rooms.size,
    connectionCount: () => connectionCount,
  };
}
