export const SEAT_SESSION_KEY = "gomoku.seat.v1";

export type SeatSession = {
  roomId: string;
  playerId: string;
  sessionToken: string;
};

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export function readSeatSession(storage: StorageLike | null | undefined): SeatSession | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(SEAT_SESSION_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<SeatSession>;
    if (
      typeof data.roomId !== "string" ||
      typeof data.playerId !== "string" ||
      typeof data.sessionToken !== "string"
    ) {
      return null;
    }
    return {
      roomId: data.roomId,
      playerId: data.playerId,
      sessionToken: data.sessionToken,
    };
  } catch {
    return null;
  }
}

export function writeSeatSession(storage: StorageLike | null | undefined, session: SeatSession): void {
  storage?.setItem(SEAT_SESSION_KEY, JSON.stringify(session));
}

export function clearSeatSession(storage: StorageLike | null | undefined): void {
  storage?.removeItem(SEAT_SESSION_KEY);
}
