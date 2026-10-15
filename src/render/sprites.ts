import { FRUITS, RAINBOW, type FruitDef } from '../game/fruits';
import type { Special, Tile } from '../game/types';

export const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

export function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

/** Pre-renders one tile at device resolution so each frame is a cheap drawImage. */
export function drawTileSprite(tile: Tile, px: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = px;
  const g = canvas.getContext('2d')!;
  if (tile.special === 'bomb') drawColorBomb(g, px);
  else drawFruitTile(g, px, FRUITS[tile.kind], tile.special);
  return canvas;
}

function drawFruitTile(g: CanvasRenderingContext2D, s: number, fruit: FruitDef, special: Special): void {
  const inset = s * 0.07;
  const w = s - inset * 2;
  const radius = s * 0.24;
  const isLine = special === 'lineH' || special === 'lineV';

  g.fillStyle = 'rgba(90, 20, 70, 0.18)';
  roundRect(g, inset, inset + s * 0.04, w, w, radius);
  g.fill();

  const body = g.createLinearGradient(0, inset, 0, inset + w);
  body.addColorStop(0, '#ffffff');
  body.addColorStop(1, fruit.light);
  g.fillStyle = body;
  roundRect(g, inset, inset, w, w, radius);
  g.fill();
  g.lineWidth = s * (isLine ? 0.06 : 0.035);
  g.strokeStyle = fruit.color;
  g.globalAlpha = isLine ? 0.9 : 0.5;
  g.stroke();
  g.globalAlpha = 1;

  if (isLine) drawStripes(g, s, inset, w, radius, fruit.color, special === 'lineH');

  g.font = `${Math.round(s * 0.56)}px ${EMOJI_FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(fruit.emoji, s / 2, s / 2 + s * 0.035);

  if (isLine) drawArrows(g, s, fruit.color, special === 'lineH');
}

function drawStripes(
  g: CanvasRenderingContext2D,
  s: number,
  inset: number,
  w: number,
  radius: number,
  color: string,
  horizontal: boolean,
): void {
  g.save();
  roundRect(g, inset, inset, w, w, radius);
  g.clip();
  g.fillStyle = color;
  g.globalAlpha = 0.3;
  const band = s * 0.08;
  for (const offset of [-0.28, 0, 0.28]) {
    const center = s / 2 + offset * s;
    if (horizontal) g.fillRect(inset, center - band / 2, w, band);
    else g.fillRect(center - band / 2, inset, band, w);
  }
  g.restore();
}

function drawArrows(g: CanvasRenderingContext2D, s: number, color: string, horizontal: boolean): void {
  const tip = s * 0.09;
  const len = s * 0.13;
  const half = s * 0.1;
  const m = s / 2;
  g.fillStyle = '#ffffff';
  g.strokeStyle = color;
  g.lineWidth = s * 0.035;
  g.lineJoin = 'round';
  const triangle = (points: [number, number][]) => {
    g.beginPath();
    points.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.fill();
    g.stroke();
  };
  if (horizontal) {
    triangle([[tip, m], [tip + len, m - half], [tip + len, m + half]]);
    triangle([[s - tip, m], [s - tip - len, m - half], [s - tip - len, m + half]]);
  } else {
    triangle([[m, tip], [m - half, tip + len], [m + half, tip + len]]);
    triangle([[m, s - tip], [m - half, s - tip - len], [m + half, s - tip - len]]);
  }
}

function drawColorBomb(g: CanvasRenderingContext2D, s: number): void {
  const c = s / 2;
  const r = s * 0.38;

  const glow = g.createRadialGradient(c, c, r * 0.6, c, c, r * 1.3);
  glow.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
  glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, s, s);

  let fill: CanvasGradient;
  if (typeof g.createConicGradient === 'function') {
    fill = g.createConicGradient(0, c, c);
    RAINBOW.forEach((color, i) => fill.addColorStop(i / RAINBOW.length, color));
    fill.addColorStop(1, RAINBOW[0]);
  } else {
    fill = g.createLinearGradient(0, 0, s, s);
    RAINBOW.forEach((color, i) => fill.addColorStop(i / (RAINBOW.length - 1), color));
  }
  g.beginPath();
  g.arc(c, c, r, 0, Math.PI * 2);
  g.fillStyle = fill;
  g.fill();
  g.lineWidth = s * 0.045;
  g.strokeStyle = '#ffffff';
  g.stroke();

  g.beginPath();
  g.ellipse(c - r * 0.32, c - r * 0.42, r * 0.34, r * 0.18, -0.5, 0, Math.PI * 2);
  g.fillStyle = 'rgba(255, 255, 255, 0.6)';
  g.fill();

  drawStar(g, c, c, r * 0.48, r * 0.2);
}

function drawStar(g: CanvasRenderingContext2D, x: number, y: number, outer: number, inner: number): void {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 ? inner : outer;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    g.lineTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
  }
  g.closePath();
  g.fillStyle = '#ffffff';
  g.shadowColor = 'rgba(90, 20, 70, 0.5)';
  g.shadowBlur = outer * 0.3;
  g.fill();
  g.shadowBlur = 0;
}
