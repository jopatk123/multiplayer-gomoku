import {
  BLACK,
  colorName,
  endReasonText,
  isFinished,
  playerById,
  remainingMs,
  type MatchState,
} from "../engine/index.ts";
import type { SeatPresence } from "../protocol.ts";

const STATUS_TEXT: Record<MatchState["status"], string> = {
  lobby: "等待开始",
  playing: "对局中",
  won: "对局结束",
  draw: "和棋",
  aborted: "对局中止",
};

export function renderHud(
  root: HTMLElement,
  state: MatchState,
  now: number,
  options: {
    youId?: string | null;
    roomId?: string | null;
    shareUrl?: string | null;
    presence?: SeatPresence[];
    onCopyLink?: () => void;
    onQuit?: (playerId: string) => void;
    onStart?: () => void;
    onReady?: (ready: boolean) => void;
    onHome?: () => void;
  },
): void {
  const current = playerById(state, state.currentPlayerId);
  const remainMs = remainingMs(state, now);
  const remain = Math.ceil(remainMs / 1000);
  const progress = state.turnDurationMs > 0 ? Math.max(0, Math.min(1, remainMs / state.turnDurationMs)) : 0;
  const pending = colorName(state.pendingColor);
  const stoneClass = state.pendingColor === BLACK ? "black" : "white";
  const playing = state.status === "playing";
  const finished = isFinished(state.status);
  const youReady = Boolean(options.youId && state.readyIds.includes(options.youId));
  const presenceById = new Map((options.presence ?? []).map((item) => [item.playerId, item]));

  const seats = (state.status === "lobby" ? state.players.map((p) => p.id) : state.order.length ? state.order : state.players.map((p) => p.id))
    .map((id) => playerById(state, id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));

  const emptySeats = state.status === "lobby" || finished ? Math.max(0, state.capacity - state.players.length) : 0;

  root.innerHTML = `
    <section class="card turn-card ${playing ? "is-playing" : ""}">
      <div class="card-head">
        <span class="badge badge-${state.status}">${STATUS_TEXT[state.status]}</span>
        <span class="muted small">${state.players.length} / ${state.capacity} 人</span>
      </div>
      <div class="turn-body">
        <div class="ring" style="--p:${playing ? progress : 0};--c:${current?.seatColor ?? "#8a8070"}">
          <div class="ring-inner">
            <span class="countdown">${playing ? remain : "—"}</span>
            <span class="ring-unit">${playing ? "秒" : ""}</span>
          </div>
        </div>
        <div class="turn-meta">
          <div class="muted small">当前行动</div>
          <div class="turn-name">
            ${current ? `<span class="dot" style="--c:${current.seatColor}"></span>${current.name}` : "—"}
            ${current && options.youId === current.id ? `<span class="tag">你</span>` : ""}
          </div>
          <div class="turn-stone">
            <span class="stone ${stoneClass}"></span>
            <span>本手执${pending}</span>
          </div>
        </div>
      </div>
      ${
        finished
          ? `<div class="end">${endReasonText(state)}${
              state.players.length === state.capacity
                ? `<div class="muted small rematch-hint">全员准备后将重新随机行动顺序并开一局。</div>`
                : `<div class="muted small rematch-hint">需再凑满 ${state.capacity} 人，全员准备后才能再开一局。</div>`
            }</div>`
          : ""
      }
    </section>

    ${
      options.roomId
        ? `<section class="card">
            <div class="card-head">
              <span class="card-title">房间</span>
              <span class="room-code">${options.roomId}</span>
            </div>
            ${
              options.shareUrl
                ? `<div class="share">
                    <input class="share-url" readonly value="${options.shareUrl.replaceAll('"', "&quot;")}" />
                    <button type="button" class="btn btn-ghost" data-act="copy">复制链接</button>
                  </div>`
                : ""
            }
          </section>`
        : ""
    }

    <section class="card">
      <div class="card-head">
        <span class="card-title">玩家</span>
        <span class="muted small">${state.status === "lobby" ? "按加入顺序" : finished ? "准备再开" : "按行动顺序"}</span>
      </div>
      <ol class="seats">
        ${seats
          .map((p, i) => {
            const isCurrent = playing && p.id === state.currentPlayerId;
            const isWinner = state.winnerId === p.id;
            const isQuit = state.quitPlayerId === p.id;
            const online = presenceById.get(p.id)?.online ?? true;
            const reconnecting = Boolean(presenceById.get(p.id) && !online);
            const isReady = state.readyIds.includes(p.id);
            return `
          <li class="seat ${isCurrent ? "current" : ""} ${isQuit ? "quit" : ""} ${reconnecting ? "reconnecting" : ""}" style="--c:${p.seatColor}">
            <span class="seat-avatar">${p.name.slice(0, 1)}</span>
            <span class="seat-name">${p.name}</span>
            <span class="seat-tags">
              ${options.youId === p.id ? `<span class="tag">你</span>` : ""}
              ${isWinner ? `<span class="tag tag-win">胜</span>` : ""}
              ${isQuit ? `<span class="tag tag-quit">退出</span>` : ""}
              ${isCurrent ? `<span class="tag tag-turn">行动中</span>` : ""}
              ${reconnecting ? `<span class="tag tag-wait">重连中</span>` : ""}
              ${finished && isReady ? `<span class="tag tag-ready">已准备</span>` : ""}
            </span>
            <span class="seat-index">${i + 1}</span>
          </li>`;
          })
          .join("")}
        ${Array.from({ length: emptySeats }, () => `<li class="seat empty"><span class="seat-avatar">?</span><span class="seat-name muted">等待加入…</span></li>`).join("")}
      </ol>
    </section>

    <div class="actions">
      ${
        state.status === "lobby" && options.onStart
          ? `<button class="btn btn-primary" data-act="start" ${state.players.length === state.capacity ? "" : "disabled"}>开始对局</button>`
          : ""
      }
      ${
        finished && options.onReady
          ? `<button class="btn btn-primary" data-act="ready" ${state.players.length === state.capacity ? "" : "disabled"}>${youReady ? "取消准备" : "准备再来一局"}</button>`
          : ""
      }
      ${playing && options.onQuit ? `<button class="btn btn-danger" data-act="quit">退出本局</button>` : ""}
      ${!playing && options.onQuit ? `<button class="btn btn-ghost" data-act="quit">离开房间</button>` : ""}
      ${options.onHome ? `<button class="btn btn-ghost" data-act="home">返回首页</button>` : ""}
    </div>
  `;

  root.querySelector<HTMLInputElement>(".share-url")?.addEventListener("focus", (ev) => {
    (ev.target as HTMLInputElement).select();
  });
  root.querySelector('[data-act="copy"]')?.addEventListener("click", () => options.onCopyLink?.());
  root.querySelector('[data-act="start"]')?.addEventListener("click", () => options.onStart?.());
  root.querySelector('[data-act="ready"]')?.addEventListener("click", () => options.onReady?.(!youReady));
  root.querySelector('[data-act="quit"]')?.addEventListener("click", () => {
    const id = options.youId ?? state.currentPlayerId;
    if (id) options.onQuit?.(id);
  });
  root.querySelector('[data-act="home"]')?.addEventListener("click", () => options.onHome?.());
}
