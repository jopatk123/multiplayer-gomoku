import { describe, expect, it } from "vitest";
import {
  addPlayer,
  applyTimeout,
  BLACK,
  BOARD_SIZE,
  createLobby,
  EMPTY,
  endReasonText,
  hasFiveOrMore,
  makeSeatPlayer,
  placeStone,
  quitMatch,
  setReady,
  startMatch,
  tick,
  timeoutThreshold,
  tryStartRematch,
  abortForReconnectTimeout,
  WHITE,
  type Cell,
  type MatchState,
} from "./index.ts";

const keepOrder = () => 0.999999;

function lobbyWith(capacity: 3 | 5, ids: string[]): MatchState {
  let state = createLobby(capacity);
  ids.forEach((id, i) => {
    state = addPlayer(state, makeSeatPlayer(i, id));
  });
  return state;
}

function start(capacity: 3 | 5, ids: string[], now = 0): MatchState {
  return startMatch(lobbyWith(capacity, ids), now, keepOrder);
}

function fillBlockPattern(board: Cell[][]): void {
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      board[y]![x] = (x + 2 * y) % 5 < 3 ? BLACK : WHITE;
    }
  }
}

describe("开局与轮转", () => {
  it("只允许 3 人或 5 人开局", () => {
    expect(() => startMatch(lobbyWith(3, ["a", "b"]), 0, keepOrder)).toThrow();
    const five = start(5, ["a", "b", "c", "d", "e"]);
    expect(five.order).toEqual(["a", "b", "c", "d", "e"]);
    expect(five.pendingColor).toBe(BLACK);
    expect(five.currentPlayerId).toBe("a");
  });

  it("3 人按顺序循环，只有实际落子才切换黑白", () => {
    let s = start(3, ["A", "B", "C"]);
    s = placeStone(s, "A", 0, 0, 0);
    expect(s.board[0]![0]).toBe(BLACK);
    expect(s.currentPlayerId).toBe("B");
    expect(s.pendingColor).toBe(WHITE);

    s = placeStone(s, "B", 1, 0, 10);
    expect(s.board[0]![1]).toBe(WHITE);
    expect(s.currentPlayerId).toBe("C");
    expect(s.pendingColor).toBe(BLACK);

    s = placeStone(s, "C", 2, 0, 20);
    expect(s.board[0]![2]).toBe(BLACK);
    expect(s.currentPlayerId).toBe("A");
    expect(s.pendingColor).toBe(WHITE);

    s = placeStone(s, "A", 3, 0, 30);
    expect(s.board[0]![3]).toBe(WHITE);
    expect(s.currentPlayerId).toBe("B");
    expect(s.pendingColor).toBe(BLACK);

    s = placeStone(s, "B", 4, 0, 40);
    expect(s.board[0]![4]).toBe(BLACK);
    expect(s.currentPlayerId).toBe("C");
    expect(s.pendingColor).toBe(WHITE);

    s = placeStone(s, "C", 5, 0, 50);
    expect(s.board[0]![5]).toBe(WHITE);
    expect(s.currentPlayerId).toBe("A");
    expect(s.pendingColor).toBe(BLACK);
  });

  it("5 人同样按顺序循环换色", () => {
    let s = start(5, ["A", "B", "C", "D", "E"]);
    const expected: Array<[string, number]> = [
      ["A", BLACK],
      ["B", WHITE],
      ["C", BLACK],
      ["D", WHITE],
      ["E", BLACK],
      ["A", WHITE],
    ];
    expected.forEach(([id, color], i) => {
      s = placeStone(s, id, i, 1, i * 10);
      expect(s.lastMove?.color).toBe(color);
      expect(s.lastMove?.playerId).toBe(id);
    });
    expect(s.currentPlayerId).toBe("B");
    expect(s.pendingColor).toBe(BLACK);
  });
});

describe("超时不换色", () => {
  it("超时不落子，轮到下一位，待落子颜色保持不变", () => {
    let s = start(3, ["A", "B", "C"], 0);
    s = applyTimeout(s, 5000);
    expect(s.currentPlayerId).toBe("B");
    expect(s.pendingColor).toBe(BLACK);
    expect(s.consecutiveTimeouts).toBe(1);
    expect(s.board[0]![0]).toBe(EMPTY);

    s = placeStone(s, "B", 0, 0, 5000);
    expect(s.board[0]![0]).toBe(BLACK);
    expect(s.currentPlayerId).toBe("C");
    expect(s.pendingColor).toBe(WHITE);
    expect(s.consecutiveTimeouts).toBe(0);
  });

  it("连续超时累计，有人落子则清零", () => {
    let s = start(3, ["A", "B", "C"], 0);
    s = applyTimeout(s, 5000);
    s = applyTimeout(s, 10000);
    expect(s.consecutiveTimeouts).toBe(2);
    s = placeStone(s, "C", 0, 0, 10000);
    expect(s.consecutiveTimeouts).toBe(0);
  });

  it("三人连续 9 次超时结束，五人 15 次，期间落子会打断", () => {
    expect(timeoutThreshold(3)).toBe(9);
    expect(timeoutThreshold(5)).toBe(15);

    let three = start(3, ["A", "B", "C"], 0);
    for (let i = 0; i < 8; i++) {
      three = applyTimeout(three, (i + 1) * 5000);
      expect(three.status).toBe("playing");
    }
    three = applyTimeout(three, 9 * 5000);
    expect(three.status).toBe("aborted");
    expect(three.endReason).toBe("consecutive_timeouts");
    expect(three.winnerId).toBeNull();
    expect(endReasonText(three)).toContain("三整轮");

    let five = start(5, ["A", "B", "C", "D", "E"], 0);
    five = applyTimeout(five, 5000);
    five = placeStone(five, "B", 0, 0, 5000);
    for (let i = 0; i < 14; i++) {
      five = applyTimeout(five, 5000 + (i + 1) * 5000);
      expect(five.status).toBe("playing");
    }
    five = applyTimeout(five, 5000 + 15 * 5000);
    expect(five.status).toBe("aborted");
    expect(five.endReason).toBe("consecutive_timeouts");
  });

  it("tick 会按经过的时间连续结算超时", () => {
    const s = tick(start(3, ["A", "B", "C"], 0), 12000);
    expect(s.consecutiveTimeouts).toBe(2);
    expect(s.currentPlayerId).toBe("C");
    expect(s.pendingColor).toBe(BLACK);
  });
});

describe("连五与长连", () => {
  it.each([
    { name: "横", spots: (n: number) => [n, 7] as const },
    { name: "竖", spots: (n: number) => [7, n] as const },
    { name: "斜下", spots: (n: number) => [5 + n, 5 + n] as const },
    { name: "斜上", spots: (n: number) => [5 + n, 10 - n] as const },
  ])("$name 向五连由完成连线者独赢", ({ spots }) => {
    let s = start(3, ["A", "B", "C"]);
    for (let i = 0; i < 4; i++) {
      const [x, y] = spots(i);
      s.board[y]![x] = BLACK;
    }
    const [x, y] = spots(4);
    s = placeStone(s, "A", x, y, 0);
    expect(s.status).toBe("won");
    expect(s.endReason).toBe("five_in_a_row");
    expect(s.winnerId).toBe("A");
    expect(hasFiveOrMore(s.board, x, y)).toBe(true);
  });

  it("长连同样获胜，且不论先前棋子由谁所下", () => {
    let s = start(3, ["A", "B", "C"]);
    for (let x = 0; x < 5; x++) {
      s.board[2]![x] = WHITE;
    }
    s.pendingColor = WHITE;
    s.currentPlayerId = "C";
    s = placeStone(s, "C", 5, 2, 0);
    expect(s.status).toBe("won");
    expect(s.winnerId).toBe("C");
    expect(hasFiveOrMore(s.board, 5, 2)).toBe(true);
  });

  it("不能落在已有棋子的位置", () => {
    let s = start(3, ["A", "B", "C"]);
    s = placeStone(s, "A", 1, 1, 0);
    expect(() => placeStone(s, "B", 1, 1, 10)).toThrow(/已有棋子/);
  });
});

describe("满盘与退出", () => {
  it("最后一手完成连线则获胜，优先于满盘平局", () => {
    let s = start(3, ["A", "B", "C"]);
    fillBlockPattern(s.board);
    for (let x = 0; x < BOARD_SIZE; x++) {
      s.board[0]![x] = x < 4 ? BLACK : WHITE;
    }
    s.board[0]![4] = EMPTY;
    s.pendingColor = BLACK;
    s = placeStone(s, "A", 4, 0, 0);
    expect(s.status).toBe("won");
    expect(s.endReason).toBe("five_in_a_row");
    expect(s.winnerId).toBe("A");
  });

  it("最后一手未形成五连则平局", () => {
    let s = start(3, ["A", "B", "C"]);
    fillBlockPattern(s.board);
    s.board[0]![2] = EMPTY;
    s.pendingColor = WHITE;
    const color = s.pendingColor;
    s = placeStone(s, "A", 2, 0, 0);
    expect(s.board[18]![18]).toBe(color);
    expect(s.status).toBe("draw");
    expect(s.endReason).toBe("board_full");
    expect(s.winnerId).toBeNull();
  });

  it("任意玩家退出立即结束，不计胜负", () => {
    let s = start(3, ["A", "B", "C"]);
    s = placeStone(s, "A", 0, 0, 0);
    s = quitMatch(s, "C");
    expect(s.status).toBe("aborted");
    expect(s.endReason).toBe("player_quit");
    expect(s.quitPlayerId).toBe("C");
    expect(s.winnerId).toBeNull();
    expect(endReasonText(s)).toContain("退出");
    expect(() => placeStone(s, "B", 1, 0, 10)).toThrow(/已结束/);
  });
});

describe("再来一局与断线中止", () => {
  it("结算后须满员且全员准备才重置轮次，不改 3/5 容量", () => {
    let s = start(3, ["A", "B", "C"]);
    s = quitMatch(s, "C");
    expect(() => tryStartRematch(s, 0, keepOrder)).toThrow(/满 3 人/);
    s = addPlayer(s, makeSeatPlayer(2, "D"));
    s = setReady(s, "A", true);
    s = setReady(s, "B", true);
    expect(() => tryStartRematch(s, 0, keepOrder)).toThrow(/全员准备/);
    s = setReady(s, "D", true);
    const next = tryStartRematch(s, 100, keepOrder);
    expect(next.status).toBe("playing");
    expect(next.capacity).toBe(3);
    expect(next.board.every((row) => row.every((cell) => cell === EMPTY))).toBe(true);
    expect(next.order).toEqual(["A", "B", "D"]);
    expect(next.pendingColor).toBe(BLACK);
    expect(next.consecutiveTimeouts).toBe(0);
    expect(next.readyIds).toEqual([]);
  });

  it("对局中不能准备，重连超时中止不计胜负", () => {
    const playing = start(3, ["A", "B", "C"]);
    expect(() => setReady(playing, "A", true)).toThrow(/尚未结束/);
    const aborted = abortForReconnectTimeout(playing, "B");
    expect(aborted.status).toBe("aborted");
    expect(aborted.endReason).toBe("reconnect_timeout");
    expect(aborted.winnerId).toBeNull();
    expect(endReasonText(aborted)).toContain("重连宽限");
  });
});
