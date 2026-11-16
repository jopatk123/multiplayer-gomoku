import type { ClientMessage, ServerMessage } from "../protocol.ts";
import type { MatchState } from "../engine/types.ts";
import type { SeatPresence } from "../protocol.ts";

export type OnlineStatePayload = {
  roomId: string;
  playerId: string;
  sessionToken: string;
  remainingMs: number;
  reconnectGraceMs: number;
  match: MatchState;
  presence: SeatPresence[];
};

export type OnlineSession = {
  close: () => void;
  send: (msg: ClientMessage) => void;
};

export function connectRoom(
  url: string,
  onState: (payload: OnlineStatePayload) => void,
  onError: (message: string) => void,
  options: { initialSessionToken?: string | null } = {},
): OnlineSession {
  const queue: ClientMessage[] = [];
  let ws: WebSocket | null = null;
  let opened = false;
  let closedByClient = false;
  let sessionToken = options.initialSessionToken ?? null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let attempts = 0;

  function clearTimer(): void {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function attach(socket: WebSocket): void {
    socket.addEventListener("open", () => {
      opened = true;
      attempts = 0;
      if (sessionToken) {
        socket.send(JSON.stringify({ type: "resume", sessionToken }));
      }
      for (const msg of queue) socket.send(JSON.stringify(msg));
      queue.length = 0;
    });

    socket.addEventListener("message", (ev) => {
      let data: ServerMessage;
      try {
        data = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        onError("收到无效数据");
        return;
      }
      if (data.type === "error") {
        onError(data.message);
        return;
      }
      if (data.type === "state") {
        sessionToken = data.sessionToken;
        onState({
          roomId: data.roomId,
          playerId: data.playerId,
          sessionToken: data.sessionToken,
          remainingMs: data.remainingMs,
          reconnectGraceMs: data.reconnectGraceMs,
          match: data.match,
          presence: data.presence,
        });
      }
    });

    socket.addEventListener("error", () => {
      if (!opened) onError("无法连接联机服务");
    });

    socket.addEventListener("close", () => {
      opened = false;
      ws = null;
      if (closedByClient) return;
      if (!sessionToken && queue.length === 0) {
        onError("连接已断开");
        return;
      }
      const wait = Math.min(1000, 150 * 2 ** Math.min(attempts, 4));
      attempts += 1;
      clearTimer();
      reconnectTimer = setTimeout(open, wait);
    });
  }

  function open(): void {
    if (closedByClient) return;
    ws = new WebSocket(url);
    attach(ws);
  }

  open();

  return {
    close() {
      closedByClient = true;
      opened = false;
      clearTimer();
      ws?.close();
      ws = null;
    },
    send(msg) {
      const raw = JSON.stringify(msg);
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(raw);
      else queue.push(msg);
    },
  };
}
