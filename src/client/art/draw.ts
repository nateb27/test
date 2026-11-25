/** Small canvas-2D drawing helpers shared by all procedural art. */

import { OUTLINE } from './palette';

export type Ctx = CanvasRenderingContext2D;
export interface Pt {
  x: number;
  y: number;
}

/** Supersampling factor: canvases are SS times larger than their logical size. */
export const SS = 2;

export interface Surface {
  canvas: HTMLCanvasElement;
  ctx: Ctx;
  /** Logical size in pixels. */
  w: number;
  h: number;
}

/** A canvas of logical size w x h; the context is pre-scaled so callers draw in logical pixels. */
export function makeSurface(w: number, h: number): Surface {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(w * SS));
  canvas.height = Math.max(1, Math.ceil(h * SS));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (ctx === null) throw new Error('2d canvas context unavailable');
  ctx.scale(SS, SS);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  return { canvas, ctx, w, h };
}

export function poly(ctx: Ctx, pts: readonly Pt[], fill: string | null, stroke: string | null = OUTLINE, lw = 1): void {
  if (pts.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
  ctx.closePath();
  if (fill !== null) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke !== null) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
}

export function line(ctx: Ctx, a: Pt, b: Pt, color: string, lw = 1): void {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.stroke();
}

/** A line with a dark outline underneath (readable props at small sizes). */
export function outlinedLine(ctx: Ctx, a: Pt, b: Pt, color: string, lw: number): void {
  line(ctx, a, b, OUTLINE, lw + 2);
  line(ctx, a, b, color, lw);
}

export function ellipse(
  ctx: Ctx,
  x: number,
  y: number,
  rx: number,
  ry: number,
  fill: string | null,
  stroke: string | null = OUTLINE,
  lw = 1,
): void {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), 0, 0, Math.PI * 2);
  if (fill !== null) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke !== null) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
}

export function circle(ctx: Ctx, x: number, y: number, r: number, fill: string | null, stroke: string | null = OUTLINE, lw = 1): void {
  ellipse(ctx, x, y, r, r, fill, stroke, lw);
}

export function rrect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, fill: string | null, stroke: string | null = OUTLINE, lw = 1): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  if (fill !== null) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke !== null) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
}

export function add(a: Pt, b: Pt): Pt {
  return { x: a.x + b.x, y: a.y + b.y };
}
export function mul(a: Pt, k: number): Pt {
  return { x: a.x * k, y: a.y * k };
}
export function lerp(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
export function up(a: Pt, h: number): Pt {
  return { x: a.x, y: a.y - h };
}

/** Soft elliptical ground shadow. */
export function shadow(ctx: Ctx, x: number, y: number, rx: number, ry: number, alpha = 0.3): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ellipse(ctx, x, y, rx, ry, '#000', null);
  ctx.restore();
}

/** Tiny deterministic PRNG for decoration (art is not part of the sim). */
export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pixel bounds of non-transparent content in a surface (logical pixels). */
export function contentBounds(s: Surface): { x: number; y: number; w: number; h: number } {
  const { canvas, ctx } = s;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let minX = canvas.width;
  let minY = canvas.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      if (data[(y * canvas.width + x) * 4 + 3]! > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { x: 0, y: 0, w: s.w, h: s.h };
  return { x: minX / SS, y: minY / SS, w: (maxX - minX + 1) / SS, h: (maxY - minY + 1) / SS };
}
