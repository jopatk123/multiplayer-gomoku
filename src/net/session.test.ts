import { describe, expect, it } from "vitest";
import { clearSeatSession, readSeatSession, writeSeatSession } from "./session.ts";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}

describe("座位会话", () => {
  it("读写并清除本机座位凭据", () => {
    const storage = memoryStorage();
    expect(readSeatSession(storage)).toBeNull();
    writeSeatSession(storage, {
      roomId: "ABC234",
      playerId: "p1",
      sessionToken: "ab".repeat(32),
    });
    expect(readSeatSession(storage)?.roomId).toBe("ABC234");
    clearSeatSession(storage);
    expect(readSeatSession(storage)).toBeNull();
  });

  it("损坏数据视为无会话", () => {
    const storage = memoryStorage();
    storage.setItem("gomoku.seat.v1", "{not json");
    expect(readSeatSession(storage)).toBeNull();
  });
});
