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
import { copyText, roomIdFromHash, roomShareUrl } from "./net/share.ts";
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
let debugOpen = false;

function setHash(hash: string): void {
  if (location.hash !== hash) location.hash = hash;
}

function syncRoomHash(roomId: string): void {
  setHash(`#/r/${roomId}`);
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
      if (payload.roomId) syncRoomHash(payload.roomId);
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
  ensureOnline();
  session?.send({ type: "create", capacity });
  render();
}

function joinOnline(roomId: string): void {
  const id = roomId.trim().toUpperCase();
  if (!id) return;
  if (mode.kind === "online" && mode.roomId === id && session) return;
  mode = { kind: "online", match: null, roomId: id, playerId: null, error: "" };
  syncRoomHash(id);
  ensureOnline();
  session?.send({ type: "join", roomId: id });
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
    <main class="home">
      <header class="hero">
        <div class="hero-stones" aria-hidden="true">
          <span class="stone black"></span><span class="stone white"></span><span class="stone black"></span>
        </div>
        <h1>多人五子棋</h1>
        <p class="sub">3 人或 5 人各自竞争 · 棋子黑白轮换，不绑定玩家 · 每手限时 5 秒</p>
      </header>
      <div class="mode-grid">
        <section class="card mode-card featured">
          <div class="mode-icon">⚔</div>
          <h2>联机房间</h2>
          <p class="hint">创建房间后复制链接发给好友，对方打开即可入座。</p>
          <div class="btn-pair">
            <button class="btn btn-primary" data-create="3">创建 3 人房</button>
            <button class="btn btn-primary" data-create="5">创建 5 人房</button>
          </div>
          <div class="divider"><span>或输入房间号</span></div>
          <div class="join">
            <input id="join-code" maxlength="8" placeholder="例如 AB12" value="${joinCode}" autocomplete="off" />
            <button class="btn btn-ghost" data-join>加入</button>
          </div>
          <p class="hint tiny">服务地址：<code>${ws ?? "未配置"}</code></p>
        </section>
        <section class="card mode-card">
          <div class="mode-icon">◎</div>
          <h2>同机试玩</h2>
          <p class="hint">一人扮演全部座位，用来熟悉规则、核对超时、换色与胜负。</p>
          <div class="btn-pair">
            <button class="btn btn-ghost" data-hotseat="3">3 人局</button>
            <button class="btn btn-ghost" data-hotseat="5">5 人局</button>
          </div>
          <ul class="rules">
            <li>落下的子与同色棋子连成五子，落子者独自获胜</li>
            <li>每落一子黑白交替，颜色不绑定玩家</li>
            <li>超时跳过该玩家且不换色，三整轮无人落子则流局</li>
          </ul>
        </section>
      </div>
    </main>
  `;
}

function renderPlayShell(): string {
  return `
    <header class="topbar">
      <a class="brand" href="#/">
        <span class="brand-mark"><span class="stone black"></span><span class="stone white"></span></span>
        多人五子棋
      </a>
      <span class="chip">${mode.kind === "hotseat" ? "同机试玩" : "联机房间"}</span>
    </header>
    ${mode.kind === "online" && mode.error ? `<p class="error">${mode.error}</p>` : ""}
    <div class="layout">
      <div class="board-wrap"><canvas id="board" width="1140" height="1140"></canvas></div>
      <aside class="side">
        <div id="hud" class="hud"></div>
        ${
          mode.kind === "hotseat"
            ? `<details class="card debug">
                <summary>调试工具</summary>
                <p class="hint">当前座位直接落子。可指定任意玩家退出，用于验证中途结束。</p>
                <div class="debug-btns" id="debug-quit"></div>
              </details>`
            : ""
        }
      </aside>
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
    const pendingId = mode.kind === "online" ? mode.roomId : null;
    const pendingShare = pendingId ? roomShareUrl(pendingId) : "";
    hud.innerHTML = `
      <section class="card">
        <div class="loading"><span class="spinner"></span>${pendingId ? `正在进入房间 ${pendingId}…` : "正在连接房间…"}</div>
        ${pendingShare ? `<div class="share"><input class="share-url" readonly value="${pendingShare.replaceAll('"', "&quot;")}" /><button type="button" class="btn btn-ghost" data-act="copy">复制链接</button></div>` : ""}
      </section>
      <div class="actions"><button class="btn btn-ghost" data-act="home">返回首页</button></div>
    `;
    hud.querySelector('[data-act="home"]')?.addEventListener("click", goHome);
    hud.querySelector('[data-act="copy"]')?.addEventListener("click", () => {
      if (!pendingShare) return;
      hud.querySelector<HTMLInputElement>(".share-url")?.select();
      const btn = hud.querySelector<HTMLButtonElement>('[data-act="copy"]');
      void copyText(pendingShare).then((ok) => {
        if (btn) btn.textContent = ok ? "已复制" : "请手动复制";
      });
    });
    return;
  }

  bindBoard(match);
  const youId = mode.kind === "hotseat" ? match.currentPlayerId : mode.playerId;
  const shareUrl =
    mode.kind === "online" && mode.roomId ? roomShareUrl(mode.roomId) : null;
  renderHud(hud, match, Date.now(), {
    youId,
    roomId: mode.kind === "online" ? mode.roomId : null,
    shareUrl,
    onCopyLink: () => {
      if (!shareUrl) return;
      hud.querySelector<HTMLInputElement>(".share-url")?.select();
      const btn = hud.querySelector<HTMLButtonElement>('[data-act="copy"]');
      void copyText(shareUrl).then((ok) => {
        if (btn) btn.textContent = ok ? "已复制" : "请手动复制";
      });
    },
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
    const details = document.querySelector<HTMLDetailsElement>("details.debug");
    if (details) {
      details.open = debugOpen;
      details.ontoggle = () => {
        debugOpen = details.open;
      };
    }
    const box = document.querySelector("#debug-quit");
    if (box) {
      box.innerHTML = match.players
        .map((p) => `<button class="btn btn-ghost btn-sm" data-qid="${p.id}" style="--c:${p.seatColor}"><span class="dot"></span>${p.name}退出</button>`)
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
  const roomId = roomIdFromHash(location.hash);
  if (roomId) {
    joinOnline(roomId);
    return;
  }
  const hash = location.hash.replace(/^#/, "") || "/";
  const hotseat = hash.match(/^\/hotseat\/(3|5)$/);
  if (hotseat && mode.kind !== "hotseat") {
    startHotseat(Number(hotseat[1]) as Capacity);
    return;
  }
  if ((hash === "/" || hash === "") && mode.kind !== "home") {
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
    const remain = remainingClock(match);
    countdown.textContent = String(Math.ceil(remain / 1000));
    const ring = document.querySelector<HTMLElement>(".ring");
    if (ring && match.turnDurationMs > 0) {
      ring.style.setProperty("--p", String(Math.max(0, Math.min(1, remain / match.turnDurationMs))));
    }
    drawBoard(canvas, match, hover, canPlace(match));
  }
}

function remainingClock(match: MatchState): number {
  return remainingMs(match, Date.now());
}

window.addEventListener("hashchange", applyHash);
setInterval(pulse, 100);

if (roomIdFromHash(location.hash) || /\/hotseat\/(3|5)$/.test(location.hash.replace(/^#/, ""))) {
  applyHash();
} else {
  render();
}
