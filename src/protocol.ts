import { BOARD_SIZE, type Capacity, type MatchState } from "./engine/types.ts";

export const ROOM_ID_RE = /^[A-HJ-NP-Z2-9]{6}$/;
export const SESSION_TOKEN_RE = /^[a-f0-9]{64}$/;
export const MAX_CLIENT_MESSAGE_BYTES = 4096;

export type ClientMessage =
  | { type: "create"; capacity: Capacity }
  | { type: "join"; roomId: string }
  | { type: "resume"; sessionToken: string }
  | { type: "start" }
  | { type: "place"; x: number; y: number }
  | { type: "ready"; ready: boolean }
  | { type: "quit" };

export type SeatPresence = {
  playerId: string;
  online: boolean;
  reconnectDeadlineMs: number | null;
};

export type ServerMessage =
  | {
      type: "state";
      roomId: string;
      playerId: string;
      sessionToken: string;
      remainingMs: number;
      reconnectGraceMs: number;
      match: MatchState;
      presence: SeatPresence[];
    }
  | { type: "error"; message: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asCapacity(value: unknown): Capacity {
  if (value === 3 || value === 5) return value;
  throw new Error("仅支持 3 人或 5 人局");
}

function asInt(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || !Number.isSafeInteger(value)) {
    throw new Error(`${label}无效`);
  }
  return value;
}

export function parseClientMessage(raw: string, maxBytes = MAX_CLIENT_MESSAGE_BYTES): ClientMessage {
  if (typeof raw !== "string") {
    throw new Error("无效消息");
  }
  if (new TextEncoder().encode(raw).length > maxBytes) {
    throw new Error("消息过大");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("无效消息");
  }
  if (!isPlainObject(parsed) || typeof parsed.type !== "string") {
    throw new Error("无效消息");
  }

  switch (parsed.type) {
    case "create":
      return { type: "create", capacity: asCapacity(parsed.capacity) };
    case "join": {
      if (typeof parsed.roomId !== "string") throw new Error("房间号无效");
      const roomId = parsed.roomId.trim().toUpperCase();
      if (!ROOM_ID_RE.test(roomId)) throw new Error("房间号无效");
      return { type: "join", roomId };
    }
    case "resume": {
      if (typeof parsed.sessionToken !== "string" || !SESSION_TOKEN_RE.test(parsed.sessionToken)) {
        throw new Error("会话无效");
      }
      return { type: "resume", sessionToken: parsed.sessionToken };
    }
    case "start":
      return { type: "start" };
    case "place": {
      const x = asInt(parsed.x, "坐标");
      const y = asInt(parsed.y, "坐标");
      if (x < 0 || y < 0 || x >= BOARD_SIZE || y >= BOARD_SIZE) {
        throw new Error("落子超出棋盘");
      }
      return { type: "place", x, y };
    }
    case "ready": {
      if (typeof parsed.ready !== "boolean") throw new Error("准备状态无效");
      return { type: "ready", ready: parsed.ready };
    }
    case "quit":
      return { type: "quit" };
    default:
      throw new Error("未知消息");
  }
}
