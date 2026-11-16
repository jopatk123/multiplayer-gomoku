import type { Capacity, MatchState } from "./engine/types.ts";

export type ClientMessage =
  | { type: "create"; capacity: Capacity }
  | { type: "join"; roomId: string }
  | { type: "start" }
  | { type: "place"; x: number; y: number }
  | { type: "quit" };

export type ServerMessage =
  | {
      type: "state";
      roomId: string;
      playerId: string;
      remainingMs: number;
      match: MatchState;
    }
  | { type: "error"; message: string };

export function parseClientMessage(raw: string): ClientMessage {
  const data = JSON.parse(raw) as ClientMessage;
  if (!data || typeof data !== "object" || typeof data.type !== "string") {
    throw new Error("无效消息");
  }
  return data;
}
