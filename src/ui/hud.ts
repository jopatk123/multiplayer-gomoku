import {
  BLACK,
  colorName,
  endReasonText,
  playerById,
  remainingMs,
  type MatchState,
} from "../engine/index.ts";

export function renderHud(
  root: HTMLElement,
  state: MatchState,
  now: number,
  options: {
    youId?: string | null;
    roomId?: string | null;
    onQuit?: (playerId: string) => void;
    onStart?: () => void;
    onHome?: () => void;
  },
): void {
  const current = playerById(state, state.currentPlayerId);
  const remain = Math.ceil(remainingMs(state, now) / 1000);
  const pending = colorName(state.pendingColor);
  const you = playerById(state, options.youId ?? null);

  const seats = (state.status === "playing" || state.status === "won" || state.status === "draw" || state.status === "aborted"
    ? state.order
    : state.players.map((p) => p.id)
  )
    .map((id) => playerById(state, id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));

  root.innerHTML = `
    <h2>对局信息</h2>
    ${options.roomId ? `<div class="stat"><span>房间</span><b>${options.roomId}</b></div>` : ""}
    <div class="stat"><span>人数</span><b>${state.players.length} / ${state.capacity}</b></div>
    ${you ? `<div class="stat"><span>你是</span><b>${you.name}</b></div>` : ""}
    <div class="stat"><span>本手颜色</span>
      <b class="stone-preview">
        <span class="stone ${state.pendingColor === BLACK ? "black" : "white"}"></span>
        ${pending}
      </b>
    </div>
    <div class="stat"><span>当前行动</span><b>${current ? current.name : "—"}</b></div>
    <div class="countdown">${state.status === "playing" ? remain : "—"}</div>
    <div class="seats">
      ${seats
        .map(
          (p, i) => `
        <div class="seat ${p.id === state.currentPlayerId ? "current" : ""}">
          <span class="dot" style="background:${p.seatColor}"></span>
          <span>${i + 1}. ${p.name}${options.youId === p.id ? "（你）" : ""}</span>
        </div>`,
        )
        .join("")}
    </div>
    ${
      state.status !== "playing" && state.status !== "lobby"
        ? `<div class="end">${endReasonText(state)}</div>`
        : ""
    }
    <div class="row" style="margin-top:12px">
      ${
        state.status === "lobby" && options.onStart
          ? `<button class="primary" data-act="start" ${state.players.length === state.capacity ? "" : "disabled"}>开始</button>`
          : ""
      }
      ${
        state.status === "playing" && options.onQuit
          ? `<button data-act="quit">退出本局</button>`
          : ""
      }
      ${options.onHome ? `<button data-act="home">返回</button>` : ""}
    </div>
  `;

  root.querySelector('[data-act="start"]')?.addEventListener("click", () => options.onStart?.());
  root.querySelector('[data-act="quit"]')?.addEventListener("click", () => {
    const id = options.youId ?? state.currentPlayerId;
    if (id) options.onQuit?.(id);
  });
  root.querySelector('[data-act="home"]')?.addEventListener("click", () => options.onHome?.());
}
