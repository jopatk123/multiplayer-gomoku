import {
  BLACK,
  BOARD_SIZE,
  EMPTY,
  SEAT_PALETTE,
  TURN_MS,
  WHITE,
  type Capacity,
  type Cell,
  type MatchState,
  type Player,
  type Rng,
  type StoneColor,
} from "./types.ts";

export function emptyBoard(): Cell[][] {
  return Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => EMPTY),
  );
}

export function cloneMatch(state: MatchState): MatchState {
  return {
    ...state,
    board: state.board.map((row) => row.slice()),
    players: state.players.map((p) => ({ ...p })),
    order: state.order.slice(),
    lastMove: state.lastMove ? { ...state.lastMove } : null,
    readyIds: state.readyIds.slice(),
    quitPlayerName: state.quitPlayerName,
  };
}

export function timeoutThreshold(playerCount: number): number {
  return playerCount * 3;
}

export function createLobby(capacity: Capacity): MatchState {
  if (capacity !== 3 && capacity !== 5) {
    throw new Error("仅支持 3 人或 5 人局");
  }
  return {
    capacity,
    board: emptyBoard(),
    players: [],
    order: [],
    currentPlayerId: null,
    pendingColor: BLACK,
    turnStartedAt: 0,
    turnDurationMs: TURN_MS,
    consecutiveTimeouts: 0,
    status: "lobby",
    endReason: null,
    winnerId: null,
    quitPlayerId: null,
    quitPlayerName: null,
    lastMove: null,
    readyIds: [],
  };
}

export function isFinished(status: MatchState["status"]): boolean {
  return status === "won" || status === "draw" || status === "aborted";
}

export function addPlayer(
  state: MatchState,
  player: Player,
): MatchState {
  const next = cloneMatch(state);
  if (next.status !== "lobby" && !isFinished(next.status)) {
    throw new Error("对局已开始，不能加入");
  }
  if (next.players.some((p) => p.id === player.id)) {
    throw new Error("玩家已在房间内");
  }
  if (next.players.length >= next.capacity) {
    throw new Error("房间已满");
  }
  next.players.push(player);
  return next;
}

export function removeLobbyPlayer(state: MatchState, playerId: string): MatchState {
  const next = cloneMatch(state);
  if (next.status !== "lobby") {
    throw new Error("对局进行中请使用退出结束本局");
  }
  next.players = next.players.filter((p) => p.id !== playerId);
  return next;
}

export function makeSeatPlayer(index: number, id: string): Player {
  const seat = SEAT_PALETTE[index];
  if (!seat) {
    throw new Error("座位不足");
  }
  return { id, name: seat.name, seatColor: seat.seatColor };
}

export function shuffleIds(ids: string[], rng: Rng): string[] {
  const order = ids.slice();
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = order[i];
    order[i] = order[j]!;
    order[j] = tmp!;
  }
  return order;
}

export function startMatch(
  state: MatchState,
  now: number,
  rng: Rng,
): MatchState {
  const next = cloneMatch(state);
  if (next.status !== "lobby") {
    throw new Error("对局已经开始");
  }
  if (next.players.length !== next.capacity) {
    throw new Error(`需要满 ${next.capacity} 人才能开始`);
  }
  next.order = shuffleIds(
    next.players.map((p) => p.id),
    rng,
  );
  next.status = "playing";
  next.currentPlayerId = next.order[0]!;
  next.pendingColor = BLACK;
  next.turnStartedAt = now;
  next.consecutiveTimeouts = 0;
  next.board = emptyBoard();
  next.endReason = null;
  next.winnerId = null;
  next.quitPlayerId = null;
  next.quitPlayerName = null;
  next.lastMove = null;
  next.readyIds = [];
  return next;
}

export function remainingMs(state: MatchState, now: number): number {
  if (state.status !== "playing") return 0;
  return Math.max(0, state.turnStartedAt + state.turnDurationMs - now);
}

function inBounds(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < BOARD_SIZE && y < BOARD_SIZE;
}

function countRay(
  board: Cell[][],
  x: number,
  y: number,
  dx: number,
  dy: number,
  color: StoneColor,
): number {
  let n = 0;
  let cx = x + dx;
  let cy = y + dy;
  while (inBounds(cx, cy) && board[cy]![cx] === color) {
    n += 1;
    cx += dx;
    cy += dy;
  }
  return n;
}

export function lineLengthAt(
  board: Cell[][],
  x: number,
  y: number,
  dx: number,
  dy: number,
): number {
  const color = board[y]![x];
  if (color === EMPTY) return 0;
  return 1 + countRay(board, x, y, dx, dy, color) + countRay(board, x, y, -dx, -dy, color);
}

export function hasFiveOrMore(board: Cell[][], x: number, y: number): boolean {
  const dirs: Array<[number, number]> = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ];
  return dirs.some(([dx, dy]) => lineLengthAt(board, x, y, dx, dy) >= 5);
}

export function isBoardFull(board: Cell[][]): boolean {
  for (const row of board) {
    for (const cell of row) {
      if (cell === EMPTY) return false;
    }
  }
  return true;
}

function nextPlayerId(state: MatchState): string {
  const idx = state.order.indexOf(state.currentPlayerId ?? "");
  if (idx < 0) {
    throw new Error("当前行动者不在顺序中");
  }
  return state.order[(idx + 1) % state.order.length]!;
}

function advanceTurn(state: MatchState, now: number, flipColor: boolean): void {
  state.currentPlayerId = nextPlayerId(state);
  if (flipColor) {
    state.pendingColor = state.pendingColor === BLACK ? WHITE : BLACK;
  }
  state.turnStartedAt = now;
}

export function placeStone(
  state: MatchState,
  playerId: string,
  x: number,
  y: number,
  now: number,
): MatchState {
  const next = tick(state, now);
  if (next.status !== "playing") {
    throw new Error("对局已结束");
  }
  if (next.currentPlayerId !== playerId) {
    throw new Error("还没轮到该玩家");
  }
  if (!inBounds(x, y)) {
    throw new Error("落子超出棋盘");
  }
  if (next.board[y]![x] !== EMPTY) {
    throw new Error("该交叉点已有棋子");
  }

  next.board[y]![x] = next.pendingColor;
  next.lastMove = {
    x,
    y,
    color: next.pendingColor,
    playerId,
  };
  next.consecutiveTimeouts = 0;

  if (hasFiveOrMore(next.board, x, y)) {
    next.status = "won";
    next.endReason = "five_in_a_row";
    next.winnerId = playerId;
    next.currentPlayerId = null;
    return next;
  }

  if (isBoardFull(next.board)) {
    next.status = "draw";
    next.endReason = "board_full";
    next.winnerId = null;
    next.currentPlayerId = null;
    return next;
  }

  advanceTurn(next, now, true);
  return next;
}

export function applyTimeout(state: MatchState, now: number): MatchState {
  const next = cloneMatch(state);
  if (next.status !== "playing") return next;
  next.consecutiveTimeouts += 1;
  if (next.consecutiveTimeouts >= timeoutThreshold(next.order.length)) {
    next.status = "aborted";
    next.endReason = "consecutive_timeouts";
    next.currentPlayerId = null;
    return next;
  }
  advanceTurn(next, now, false);
  return next;
}

export function tick(state: MatchState, now: number): MatchState {
  let next = cloneMatch(state);
  while (
    next.status === "playing" &&
    now >= next.turnStartedAt + next.turnDurationMs
  ) {
    next = applyTimeout(next, next.turnStartedAt + next.turnDurationMs);
  }
  return next;
}

function dropFinishedPlayer(state: MatchState, playerId: string): MatchState {
  const next = cloneMatch(state);
  next.players = next.players.filter((p) => p.id !== playerId);
  next.readyIds = next.readyIds.filter((id) => id !== playerId);
  next.order = next.order.filter((id) => id !== playerId);
  return next;
}

export function quitMatch(state: MatchState, playerId: string): MatchState {
  const next = cloneMatch(state);
  if (next.status === "lobby") {
    return removeLobbyPlayer(next, playerId);
  }
  if (isFinished(next.status)) {
    return dropFinishedPlayer(next, playerId);
  }
  if (next.status !== "playing") {
    return next;
  }
  const player = next.players.find((p) => p.id === playerId);
  if (!player) {
    throw new Error("玩家不在本局中");
  }
  next.status = "aborted";
  next.endReason = "player_quit";
  next.quitPlayerId = playerId;
  next.quitPlayerName = player.name;
  next.winnerId = null;
  next.currentPlayerId = null;
  next.readyIds = [];
  return dropFinishedPlayer(next, playerId);
}

export function abortForReconnectTimeout(state: MatchState, playerId: string): MatchState {
  const next = cloneMatch(state);
  if (next.status !== "playing") {
    return next;
  }
  const player = next.players.find((p) => p.id === playerId);
  if (!player) {
    throw new Error("玩家不在本局中");
  }
  next.status = "aborted";
  next.endReason = "reconnect_timeout";
  next.quitPlayerId = playerId;
  next.quitPlayerName = player.name;
  next.winnerId = null;
  next.currentPlayerId = null;
  next.readyIds = [];
  return dropFinishedPlayer(next, playerId);
}

export function setReady(state: MatchState, playerId: string, ready: boolean): MatchState {
  const next = cloneMatch(state);
  if (!isFinished(next.status)) {
    throw new Error("对局尚未结束，不能准备下一局");
  }
  if (!next.players.some((p) => p.id === playerId)) {
    throw new Error("玩家不在本局中");
  }
  const set = new Set(next.readyIds);
  if (ready) set.add(playerId);
  else set.delete(playerId);
  next.readyIds = [...set];
  return next;
}

export function tryStartRematch(state: MatchState, now: number, rng: Rng): MatchState {
  if (!isFinished(state.status)) {
    throw new Error("对局尚未结束");
  }
  if (state.players.length !== state.capacity) {
    throw new Error(`需要满 ${state.capacity} 人才能开始`);
  }
  if (state.players.some((p) => !state.readyIds.includes(p.id))) {
    throw new Error("需全员准备后再开一局");
  }
  const lobby = createLobby(state.capacity);
  lobby.players = state.players.map((p) => ({ ...p }));
  return startMatch(lobby, now, rng);
}

export function colorName(color: StoneColor): "黑" | "白" {
  return color === BLACK ? "黑" : "白";
}

export function playerById(state: MatchState, id: string | null): Player | undefined {
  if (!id) return undefined;
  return state.players.find((p) => p.id === id);
}

export function endReasonText(state: MatchState): string {
  switch (state.endReason) {
    case "five_in_a_row": {
      const winner = playerById(state, state.winnerId);
      const stone = state.lastMove ? colorName(state.lastMove.color) : "";
      return `${winner?.name ?? "有人"}落下${stone}子，形成同色连续五子或更长，独自获胜。`;
    }
    case "board_full":
      return "棋盘已满且无人形成五连，本局平局。";
    case "player_quit": {
      const quitter = playerById(state, state.quitPlayerId);
      return `${quitter?.name ?? state.quitPlayerName ?? "有人"}主动中途退出，本局结束，不计胜负。`;
    }
    case "consecutive_timeouts":
      return `连续 ${timeoutThreshold(state.order.length)} 次无人落子（三整轮超时），本局结束，不计胜负。`;
    case "reconnect_timeout": {
      const missing = playerById(state, state.quitPlayerId);
      return `${missing?.name ?? state.quitPlayerName ?? "有人"}断线超过重连宽限，本局结束，不计胜负。`;
    }
    default:
      return "";
  }
}
