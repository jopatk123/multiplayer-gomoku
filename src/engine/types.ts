export const BOARD_SIZE = 19;
export const TURN_MS = 5000;
export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;

export type StoneColor = typeof BLACK | typeof WHITE;
export type Cell = typeof EMPTY | StoneColor;
export type Capacity = 3 | 5;
export type MatchStatus = "lobby" | "playing" | "won" | "draw" | "aborted";
export type EndReason =
  | "five_in_a_row"
  | "board_full"
  | "player_quit"
  | "consecutive_timeouts";

export type Player = {
  id: string;
  name: string;
  seatColor: string;
};

export type LastMove = {
  x: number;
  y: number;
  color: StoneColor;
  playerId: string;
};

export type MatchState = {
  capacity: Capacity;
  board: Cell[][];
  players: Player[];
  order: string[];
  currentPlayerId: string | null;
  pendingColor: StoneColor;
  turnStartedAt: number;
  turnDurationMs: number;
  consecutiveTimeouts: number;
  status: MatchStatus;
  endReason: EndReason | null;
  winnerId: string | null;
  quitPlayerId: string | null;
  lastMove: LastMove | null;
};

export type Rng = () => number;

export const SEAT_PALETTE: ReadonlyArray<{ name: string; seatColor: string }> = [
  { name: "青", seatColor: "#1f9aa3" },
  { name: "赤", seatColor: "#d64545" },
  { name: "金", seatColor: "#c99712" },
  { name: "翠", seatColor: "#2f8f4e" },
  { name: "紫", seatColor: "#6d5aa8" },
];
