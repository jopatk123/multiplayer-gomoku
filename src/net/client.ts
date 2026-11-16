import type { ClientMessage, ServerMessage } from "../protocol.ts";
import type { MatchState } from "../engine/types.ts";

export type OnlineSession = {
  close: () => void;
  send: (msg: ClientMessage) => void;
};

export function connectRoom(
  url: string,
  onState: (payload: {
    roomId: string;
    playerId: string;
    remainingMs: number;
    match: MatchState;
  }) => void,
  onError: (message: string) => void,
): OnlineSession {
  const ws = new WebSocket(url);
  const queue: ClientMessage[] = [];
  let opened = false;

  ws.addEventListener("open", () => {
    opened = true;
    for (const msg of queue) ws.send(JSON.stringify(msg));
    queue.length = 0;
  });

  ws.addEventListener("message", (ev) => {
    const data = JSON.parse(String(ev.data)) as ServerMessage;
    if (data.type === "error") {
      onError(data.message);
      return;
    }
    if (data.type === "state") {
      onState({
        roomId: data.roomId,
        playerId: data.playerId,
        remainingMs: data.remainingMs,
        match: data.match,
      });
    }
  });

  ws.addEventListener("error", () => {
    onError("无法连接本机联机服务。请先启动 npm run dev。");
  });

  ws.addEventListener("close", () => {
    if (opened) onError("连接已断开");
  });

  return {
    close() {
      opened = false;
      ws.close();
    },
    send(msg) {
      const raw = JSON.stringify(msg);
      if (ws.readyState === WebSocket.OPEN) ws.send(raw);
      else queue.push(msg);
    },
  };
}
