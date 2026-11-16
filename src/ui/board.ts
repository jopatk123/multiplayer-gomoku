import { BLACK, BOARD_SIZE, EMPTY, type MatchState, type StoneColor } from "../engine/index.ts";

const STAR = [3, 9, 15];

export function intersectionFromEvent(
  canvas: HTMLCanvasElement,
  event: { clientX: number; clientY: number },
): { x: number; y: number } | null {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const px = (event.clientX - rect.left) * scaleX;
  const py = (event.clientY - rect.top) * scaleY;
  const margin = canvas.width * 0.06;
  const gap = (canvas.width - margin * 2) / (BOARD_SIZE - 1);
  const x = Math.round((px - margin) / gap);
  const y = Math.round((py - margin) / gap);
  if (x < 0 || y < 0 || x >= BOARD_SIZE || y >= BOARD_SIZE) return null;
  const dx = px - (margin + x * gap);
  const dy = py - (margin + y * gap);
  if (dx * dx + dy * dy > (gap * 0.42) ** 2) return null;
  return { x, y };
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
  const margin = size * 0.06;
  const gap = (size - margin * 2) / (BOARD_SIZE - 1);

  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = "#e0b56a";
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = "#5a3b16";
  ctx.lineWidth = 1.2;
  for (let i = 0; i < BOARD_SIZE; i++) {
    const p = margin + i * gap;
    ctx.beginPath();
    ctx.moveTo(margin, p);
    ctx.lineTo(size - margin, p);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(p, margin);
    ctx.lineTo(p, size - margin);
    ctx.stroke();
  }

  ctx.fillStyle = "#3b2410";
  for (const sx of STAR) {
    for (const sy of STAR) {
      ctx.beginPath();
      ctx.arc(margin + sx * gap, margin + sy * gap, Math.max(2.2, gap * 0.08), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (canPlace && hover && state.board[hover.y]![hover.x] === EMPTY && state.status === "playing") {
    drawStone(ctx, margin + hover.x * gap, margin + hover.y * gap, gap * 0.42, state.pendingColor, 0.45);
  }

  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const cell = state.board[y]![x];
      if (cell === EMPTY) continue;
      const last = state.lastMove;
      drawStone(ctx, margin + x * gap, margin + y * gap, gap * 0.42, cell, 1);
      if (last && last.x === x && last.y === y) {
        ctx.beginPath();
        ctx.strokeStyle = cell === BLACK ? "#f2d27a" : "#c45c1a";
        ctx.lineWidth = 2;
        ctx.arc(margin + x * gap, margin + y * gap, gap * 0.16, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }
}

function drawStone(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: StoneColor,
  alpha: number,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  const grd = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
  if (color === BLACK) {
    grd.addColorStop(0, "#4a4a4a");
    grd.addColorStop(1, "#111");
  } else {
    grd.addColorStop(0, "#fff");
    grd.addColorStop(1, "#cfcfcf");
  }
  ctx.beginPath();
  ctx.fillStyle = grd;
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
