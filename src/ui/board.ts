import { BLACK, BOARD_SIZE, EMPTY, type MatchState, type StoneColor } from "../engine/index.ts";

const STAR = [3, 9, 15];
const COLS = "ABCDEFGHJKLMNOPQRST";

function metrics(size: number): { margin: number; gap: number } {
  const margin = size * 0.07;
  return { margin, gap: (size - margin * 2) / (BOARD_SIZE - 1) };
}

export function intersectionFromEvent(
  canvas: HTMLCanvasElement,
  event: { clientX: number; clientY: number },
): { x: number; y: number } | null {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const px = (event.clientX - rect.left) * scaleX;
  const py = (event.clientY - rect.top) * scaleY;
  const { margin, gap } = metrics(canvas.width);
  const x = Math.round((px - margin) / gap);
  const y = Math.round((py - margin) / gap);
  if (x < 0 || y < 0 || x >= BOARD_SIZE || y >= BOARD_SIZE) return null;
  const dx = px - (margin + x * gap);
  const dy = py - (margin + y * gap);
  if (dx * dx + dy * dy > (gap * 0.42) ** 2) return null;
  return { x, y };
}

let woodCache: { size: number; canvas: HTMLCanvasElement } | null = null;

function woodTexture(size: number): HTMLCanvasElement {
  if (woodCache && woodCache.size === size) return woodCache.canvas;
  const off = document.createElement("canvas");
  off.width = size;
  off.height = size;
  const ctx = off.getContext("2d")!;

  const base = ctx.createLinearGradient(0, 0, size, size);
  base.addColorStop(0, "#e9c287");
  base.addColorStop(0.5, "#ddb072");
  base.addColorStop(1, "#cf9d5c");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  ctx.globalAlpha = 0.07;
  ctx.strokeStyle = "#7a4a1c";
  for (let i = 0; i < 90; i++) {
    const y0 = (i / 90) * size;
    ctx.lineWidth = 0.6 + ((i * 37) % 5) * 0.35;
    ctx.beginPath();
    for (let x = 0; x <= size; x += 8) {
      const y = y0 + Math.sin(x / (size * 0.11) + i * 1.7) * size * 0.006 + Math.sin(x / (size * 0.031) + i) * 1.2;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const vignette = ctx.createRadialGradient(size / 2, size / 2, size * 0.3, size / 2, size / 2, size * 0.75);
  vignette.addColorStop(0, "rgba(255,240,210,0.12)");
  vignette.addColorStop(1, "rgba(90,50,15,0.22)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, size, size);

  woodCache = { size, canvas: off };
  return off;
}

export function drawBoard(
  canvas: HTMLCanvasElement,
  state: MatchState,
  hover: { x: number; y: number } | null,
  canPlace: boolean,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const size = canvas.width;
  const { margin, gap } = metrics(size);
  const at = (i: number) => margin + i * gap;

  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(woodTexture(size), 0, 0);

  ctx.strokeStyle = "rgba(60,34,10,0.78)";
  ctx.lineWidth = Math.max(1, size / 760);
  for (let i = 0; i < BOARD_SIZE; i++) {
    const p = Math.round(at(i)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(margin, p);
    ctx.lineTo(size - margin, p);
    ctx.moveTo(p, margin);
    ctx.lineTo(p, size - margin);
    ctx.stroke();
  }
  ctx.lineWidth = Math.max(2, size / 380);
  ctx.strokeRect(margin, margin, size - margin * 2, size - margin * 2);

  ctx.fillStyle = "rgba(50,28,8,0.9)";
  for (const sx of STAR) {
    for (const sy of STAR) {
      ctx.beginPath();
      ctx.arc(at(sx), at(sy), Math.max(2.5, gap * 0.09), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.fillStyle = "rgba(70,40,12,0.62)";
  ctx.font = `600 ${Math.round(gap * 0.32)}px ui-sans-serif, -apple-system, "PingFang SC", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const labelOffset = margin * 0.5;
  for (let i = 0; i < BOARD_SIZE; i++) {
    ctx.fillText(COLS[i]!, at(i), labelOffset);
    ctx.fillText(COLS[i]!, at(i), size - labelOffset);
    ctx.fillText(String(BOARD_SIZE - i), labelOffset, at(i));
    ctx.fillText(String(BOARD_SIZE - i), size - labelOffset, at(i));
  }

  const r = gap * 0.45;
  if (canPlace && hover && state.board[hover.y]![hover.x] === EMPTY && state.status === "playing") {
    drawStone(ctx, at(hover.x), at(hover.y), r, state.pendingColor, 0.5, false);
  }

  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const cell = state.board[y]![x];
      if (cell === EMPTY) continue;
      drawStone(ctx, at(x), at(y), r, cell, 1, true);
    }
  }

  const last = state.lastMove;
  if (last) {
    ctx.beginPath();
    ctx.fillStyle = "#e5483a";
    ctx.arc(at(last.x), at(last.y), gap * 0.11, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawStone(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: StoneColor,
  alpha: number,
  shadow: boolean,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  if (shadow) {
    ctx.shadowColor = "rgba(40,20,5,0.45)";
    ctx.shadowBlur = r * 0.35;
    ctx.shadowOffsetX = r * 0.12;
    ctx.shadowOffsetY = r * 0.18;
  }
  const grd = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.05, x, y, r * 1.05);
  if (color === BLACK) {
    grd.addColorStop(0, "#6b6b70");
    grd.addColorStop(0.35, "#2a2a2e");
    grd.addColorStop(1, "#0a0a0c");
  } else {
    grd.addColorStop(0, "#ffffff");
    grd.addColorStop(0.6, "#f0ede6");
    grd.addColorStop(1, "#c9c3b8");
  }
  ctx.beginPath();
  ctx.fillStyle = grd;
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
