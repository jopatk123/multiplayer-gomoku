import "./ui/styles.css";
import {
  addPlayer,
  createLobby,
  makeSeatPlayer,
  placeStone,
  quitMatch,
  remainingMs,
  startMatch,
  tick,
  type Capacity,
  type MatchState,
} from "./engine/index.ts";
import { connectRoom, type OnlineSession } from "./net/client.ts";
import { resolveWsUrl } from "./net/wsUrl.ts";
import { drawBoard, intersectionFromEvent } from "./ui/board.ts";
import { renderHud } from "./ui/hud.ts";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("#app missing");
const root = app;

type Mode =
  | { kind: "home" }
  | { kind: "hotseat"; capacity: Capacity; match: MatchState }
  | {
      kind: "online";
      match: MatchState | null;
      roomId: string | null;
      playerId: string | null;
      error: string;
    };

let mode: Mode = { kind: "home" };
let session: OnlineSession | null = null;
let hover: { x: number; y: number } | null = null;
let joinCode = "";

function setHash(hash: string): void {
  if (location.hash !== hash) location.hash = hash;
}

function goHome(): void {
  session?.close();
  session = null;
  mode = { kind: "home" };
  setHash("#/");
  render();
}

function startHotseat(capacity: Capacity): void {
  session?.close();
  session = null;
  let match = createLobby(capacity);
  for (let i = 0; i < capacity; i++) {
    match = addPlayer(match, makeSeatPlayer(i, `local-${i}`));
  }
  match = startMatch(match, Date.now(), Math.random);
  mode = { kind: "hotseat", capacity, match };
  setHash(`#/hotseat/${capacity}`);
  render();
}

function ensureOnline(): void {
  const url = resolveWsUrl();
  if (!url) {
    mode = {
      kind: "online",
      match: null,
      roomId: null,
      playerId: null,
      error: "未配置联机地址。请设置 VITE_WS_URL，例如 ws://127.0.0.1:18765。",
    };
    render();
    return;
  }
  session?.close();
  session = connectRoom(
    url,
    (payload) => {
      mode = {
        kind: "online",
        match: payload.match,
        roomId: payload.roomId,
        playerId: payload.playerId,
        error: "",
      };
      render();
    },
    (message) => {
      if (mode.kind === "online") {
        mode = { ...mode, error: message };
      } else {
        mode = { kind: "online", match: null, roomId: null, playerId: null, error: message };
      }
      render();
    },
  );
}

function createOnline(capacity: Capacity): void {
  mode = { kind: "online", match: null, roomId: null, playerId: null, error: "" };
  setHash("#/online");
  ensureOnline();
  session?.send({ type: "create", capacity });
  render();
}

function joinOnline(roomId: string): void {
  mode = { kind: "online", match: null, roomId: null, playerId: null, error: "" };
  setHash("#/online");
  ensureOnline();
  session?.send({ type: "join", roomId });
  render();
}

function currentMatch(): MatchState | null {
  if (mode.kind === "hotseat") return tick(mode.match, Date.now());
  if (mode.kind === "online") return mode.match ? tick(mode.match, Date.now()) : null;
  return null;
}

function canPlace(match: MatchState): boolean {
  if (match.status !== "playing" || !match.currentPlayerId) return false;
  if (mode.kind === "hotseat") return true;
  if (mode.kind === "online") return mode.playerId === match.currentPlayerId;
  return false;
}

function place(x: number, y: number): void {
  const match = currentMatch();
  if (!match || !canPlace(match) || !match.currentPlayerId) return;
  if (mode.kind === "hotseat") {
    try {
      mode.match = placeStone(match, match.currentPlayerId, x, y, Date.now());
      render();
    } catch {
      /* occupied or not your turn after tick */
    }
    return;
  }
  session?.send({ type: "place", x, y });
}

function renderHome(): string {
  const ws = resolveWsUrl();
  return `
    <h1>多人五子棋</h1>
    <p class="sub">3 人或 5 人各自竞争 · 棋子黑白轮换，不绑定玩家</p>
    <div class="home-card">
      <div class="panel">
        <h2>同机调试席位</h2>
        <p class="hint">一人扮演全部座位，用来核对超时、换色与胜负。不是已上线联机。</p>
        <div class="row">
          <button class="primary" data-hotseat="3">3 人局</button>
          <button class="primary" data-hotseat="5">5 人局</button>
        </div>
      </div>
      <div class="panel">
        <h2>本机联机房间</h2>
        <p class="hint">地址 ${ws ?? "未配置"}。请用多个浏览器标签加入同一房间。</p>
        <div class="row">
          <button data-create="3">创建 3 人房</button>
          <button data-create="5">创建 5 人房</button>
        </div>
        <div class="row" style="margin-top:10px">
          <input id="join-code" maxlength="8" placeholder="房间号" value="${joinCode}" />
          <button data-join>加入</button>
        </div>
      </div>
    </div>
  `;
}

function renderPlayShell(): string {
  return `
    <h1>多人五子棋</h1>
    <p class="sub">${mode.kind === "hotseat" ? "同机调试席位" : "本机联机房间"}</p>
    ${mode.kind === "online" && mode.error ? `<p class="error">${mode.error}</p>` : ""}
    <div class="layout">
      <div class="board-wrap"><canvas id="board" width="760" height="760"></canvas></div>
      <div>
        <div class="panel" id="hud"></div>
        ${
          mode.kind === "hotseat"
            ? `<div class="panel" style="margin-top:12px">
                <h2>调试</h2>
                <p class="hint">当前座位直接落子。退出可指定任意玩家，用于验证中途结束。</p>
                <div class="row" id="debug-quit"></div>
              </div>`
            : ""
        }
      </div>
    </div>
  `;
}

function bindBoard(match: MatchState): void {
  const canvas = document.querySelector<HTMLCanvasElement>("#board");
  if (!canvas) return;
  const paint = () => drawBoard(canvas, match, hover, canPlace(match));
  paint();
  canvas.onmousemove = (ev) => {
    hover = intersectionFromEvent(canvas, ev);
    paint();
  };
  canvas.onmouseleave = () => {
    hover = null;
    paint();
  };
  canvas.onclick = (ev) => {
    const point = intersectionFromEvent(canvas, ev);
    if (point) place(point.x, point.y);
  };
}

function render(): void {
  if (mode.kind === "hotseat") {
    mode.match = tick(mode.match, Date.now());
  }

  if (mode.kind === "home") {
    root.innerHTML = renderHome();
    root.querySelectorAll<HTMLButtonElement>("[data-hotseat]").forEach((btn) => {
      btn.onclick = () => startHotseat(Number(btn.dataset.hotseat) as Capacity);
    });
    root.querySelectorAll<HTMLButtonElement>("[data-create]").forEach((btn) => {
      btn.onclick = () => createOnline(Number(btn.dataset.create) as Capacity);
    });
    const input = root.querySelector<HTMLInputElement>("#join-code");
    if (input) {
      input.oninput = () => {
        joinCode = input.value.toUpperCase();
      };
    }
    root.querySelector<HTMLButtonElement>("[data-join]")!.onclick = () => {
      const code = (root.querySelector<HTMLInputElement>("#join-code")?.value ?? "").trim();
      if (code) joinOnline(code);
    };
    return;
  }

  root.innerHTML = renderPlayShell();
  const match = currentMatch();
  const hud = document.querySelector<HTMLElement>("#hud");
  if (!hud) return;

  if (!match) {
    hud.innerHTML = `<p class="hint">正在连接本机房间…</p><button data-act="home">返回</button>`;
    hud.querySelector("button")?.addEventListener("click", goHome);
    return;
  }

  bindBoard(match);
  const youId = mode.kind === "hotseat" ? match.currentPlayerId : mode.playerId;
  renderHud(hud, match, Date.now(), {
    youId,
    roomId: mode.kind === "online" ? mode.roomId : null,
    onHome: goHome,
    onStart:
      mode.kind === "online"
        ? () => session?.send({ type: "start" })
        : undefined,
    onQuit: (playerId) => {
      if (mode.kind === "hotseat") {
        mode.match = quitMatch(mode.match, playerId);
        render();
      } else {
        session?.send({ type: "quit" });
      }
    },
  });

  if (mode.kind === "hotseat") {
    const box = document.querySelector("#debug-quit");
    if (box) {
      box.innerHTML = match.players
        .map((p) => `<button data-qid="${p.id}">${p.name}退出</button>`)
        .join("");
      box.querySelectorAll<HTMLButtonElement>("[data-qid]").forEach((btn) => {
        btn.onclick = () => {
          if (mode.kind !== "hotseat") return;
          mode.match = quitMatch(mode.match, btn.dataset.qid!);
          render();
        };
      });
    }
  }
}

function applyHash(): void {
  const hash = location.hash.replace(/^#/, "") || "/";
  const hotseat = hash.match(/^\/hotseat\/(3|5)$/);
  if (hotseat && mode.kind !== "hotseat") {
    startHotseat(Number(hotseat[1]) as Capacity);
    return;
  }
  if (hash === "/online") {
    if (mode.kind !== "online") {
      mode = { kind: "online", match: null, roomId: null, playerId: null, error: "" };
      ensureOnline();
      render();
    }
    return;
  }
  if (hash === "/" && mode.kind !== "home") {
    goHome();
  }
}

function pulse(): void {
  if (mode.kind === "hotseat") {
    const before = mode.match;
    mode.match = tick(mode.match, Date.now());
    if (
      before.currentPlayerId !== mode.match.currentPlayerId ||
      before.status !== mode.match.status ||
      before.consecutiveTimeouts !== mode.match.consecutiveTimeouts
    ) {
      render();
      return;
    }
  }
  const match = currentMatch();
  const countdown = document.querySelector(".countdown");
  const canvas = document.querySelector<HTMLCanvasElement>("#board");
  if (!match || !countdown || !canvas) return;
  if (match.status === "playing") {
    countdown.textContent = String(Math.ceil(remainingClock(match) / 1000));
    drawBoard(canvas, match, hover, canPlace(match));
  }
}

function remainingClock(match: MatchState): number {
  return remainingMs(match, Date.now());
}

window.addEventListener("hashchange", applyHash);
setInterval(pulse, 100);

render();
applyHash();
