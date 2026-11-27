/**
 * Procedural effect art (PLAN-M2 3.8, WP27): projectiles, hit effects, building fire and smoke, and rubble. Drawn to
 * canvases once at load like the rest of the procedural art; colours are kept close to the rendered art's palette
 * (warm fire, grey-brown dust and stone) so the same sprites serve both art modes. Nothing here is team coloured.
 *
 * Every drawing is deterministic (`mulberry` with a fixed seed), so the art is identical on every load.
 */

import type { EffectSpriteId } from './catalog';
import { circle, ellipse, line, makeSurface, mulberry, poly, SS, type Pt, type Surface } from './draw';
import { FIRE_LARGE, FIRE_SMALL, SMOKE, firePixels, smokePixels, type PaletteLookup, type PixelFrame } from './fire';
import { C, OUTLINE } from './palette';
import { sharedQuantizer } from './rendered/quantize';

export interface EffectArt {
  /** Frames (each one a surface of the same size); one entry per variant for rubble. */
  frames: Surface[][];
  /** Anchor in texture-normalised coordinates. */
  anchor: { x: number; y: number };
  frameMs: number;
  loop: boolean;
}

const FLAME_OUTER = '#d8461c';
const FLAME_MID = C.fire;
const FLAME_IN = C.fireLight;

/**
 * The shared palette for the pixel fire and smoke (`fire.ts`); without a generated palette, a small warm-and-grey
 * stand-in so the effect still draws.
 */
function firePalette(): PaletteLookup {
  const q = sharedQuantizer();
  if (q !== null) return q;
  const pal = [14, 9, 6, 41, 39, 36, 74, 74, 63, 119, 116, 111, 69, 22, 12, 127, 65, 39, 162, 93, 66, 192, 138, 76, 236, 188, 72, 250, 246, 234];
  return {
    pal,
    nearest(r, g, b) {
      let best = 0;
      let bd = Infinity;
      for (let i = 0; i < pal.length / 3; i++) {
        const d = (pal[i * 3]! - r) ** 2 + (pal[i * 3 + 1]! - g) ** 2 + (pal[i * 3 + 2]! - b) ** 2;
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      return best;
    },
  };
}

/** A pixel frame on a canvas surface: each art pixel becomes an SS x SS block (crisp at every zoom, like the sheets). */
function surfaceOf(px: PixelFrame): Surface {
  const s = makeSurface(px.w, px.h);
  const W = s.canvas.width;
  const img = s.ctx.createImageData(W, s.canvas.height);
  for (let y = 0; y < px.h; y++) {
    for (let x = 0; x < px.w; x++) {
      const j = (y * px.w + x) * 4;
      if (px.data[j + 3] === 0) continue;
      for (let dy = 0; dy < SS; dy++) {
        for (let dx = 0; dx < SS; dx++) {
          const i = ((y * SS + dy) * W + x * SS + dx) * 4;
          img.data[i] = px.data[j]!;
          img.data[i + 1] = px.data[j + 1]!;
          img.data[i + 2] = px.data[j + 2]!;
          img.data[i + 3] = px.data[j + 3]!;
        }
      }
    }
  }
  s.ctx.putImageData(img, 0, 0);
  return s;
}

/** Frames of the looping building fire and smoke (`fire.ts`), and how long each shows. */
export const FIRE_FRAMES = 8;
export const FIRE_FRAME_MS = 90;
export const SMOKE_FRAMES = 8;
export const SMOKE_FRAME_MS = 150;

/** One-shot dust cloud (frame `f` of `n`): brown-grey puffs that spread and fade. */
function drawDust(s: Surface, f: number, n: number): void {
  const { ctx, w, h } = s;
  const r = mulberry(2024);
  const t = (f + 1) / n;
  for (let k = 0; k < 9; k++) {
    const a = r() * Math.PI * 2;
    const d = (0.25 + 0.75 * r()) * t;
    const x = w / 2 + Math.cos(a) * d * w * 0.4;
    const y = h * 0.7 + Math.sin(a) * d * h * 0.28 - t * h * 0.25 * r();
    const rad = (2.5 + 4 * r()) * (0.6 + t);
    const c = k % 3 === 0 ? [139, 122, 98] : [168, 151, 123];
    const a0 = Math.max(0, 0.85 * (1 - t * t));
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${a0})`);
    g.addColorStop(0.65, `rgba(${c[0]},${c[1]},${c[2]},${a0 * 0.7})`);
    g.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** One-shot fire splash where a Siphonarios stream lands (frame `f` of `n`). */
function drawSplash(s: Surface, f: number, n: number): void {
  const { ctx, w, h } = s;
  const r = mulberry(77);
  const t = (f + 1) / n;
  const cy = h * 0.7;
  ctx.save();
  ctx.globalAlpha = 0.8 * (1 - t * 0.6);
  ellipse(ctx, w / 2, cy, w * 0.42 * (0.4 + t * 0.6), h * 0.18 * (0.4 + t * 0.6), FLAME_OUTER, null);
  ctx.restore();
  for (let k = 0; k < 7; k++) {
    const a = r() * Math.PI * 2;
    const d = t * (0.5 + 0.5 * r());
    const x = w / 2 + Math.cos(a) * d * w * 0.4;
    const y = cy + Math.sin(a) * d * h * 0.25 - Math.sin(t * Math.PI) * h * 0.35 * r();
    ctx.save();
    ctx.globalAlpha = 1 - t * 0.8;
    circle(ctx, x, y, 1.6 + 1.6 * (1 - t), k % 2 === 0 ? FLAME_MID : FLAME_IN, null);
    ctx.restore();
  }
  if (t > 0.5) {
    ctx.save();
    ctx.globalAlpha = (t - 0.5) * 0.9;
    circle(ctx, w / 2, cy - h * 0.35 * t, 3 + 3 * t, '#4a443e', null);
    ctx.restore();
  }
}

/** One-shot melee or arrow hit (frame `f` of `n`): a white-yellow star that bursts and fades. */
function drawHit(s: Surface, f: number, n: number): void {
  const { ctx, w, h } = s;
  const t = (f + 1) / n;
  const cx = w / 2;
  const cy = h / 2;
  const len = 2 + t * (w * 0.42);
  ctx.save();
  ctx.globalAlpha = f === n - 1 ? 0.45 : 1;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + 0.2;
    const l = k % 2 === 0 ? len : len * 0.6;
    const inner = t * len * 0.35;
    line(ctx, { x: cx + Math.cos(a) * inner, y: cy + Math.sin(a) * inner * 0.7 }, { x: cx + Math.cos(a) * l, y: cy + Math.sin(a) * l * 0.7 }, k % 2 === 0 ? '#fff6d0' : '#ffd25a', 1.3);
  }
  if (f < 2) circle(ctx, cx, cy, 2.2 - f * 0.6, '#ffffff', null);
  ctx.restore();
}

/** Arrow pointing along +x (the renderer rotates it to its screen velocity). */
function drawArrow(s: Surface): void {
  const { ctx, w, h } = s;
  const y = h / 2;
  line(ctx, { x: 2, y }, { x: w - 3, y }, OUTLINE, 2.4);
  line(ctx, { x: 2, y }, { x: w - 3, y }, C.woodLight, 1.1);
  poly(ctx, [{ x: w - 0.5, y }, { x: w - 3.5, y: y - 1.5 }, { x: w - 3.5, y: y + 1.5 }], C.steel, OUTLINE, 0.6);
  poly(ctx, [{ x: 0.5, y: y - 1.6 }, { x: 3.5, y: y - 0.4 }, { x: 3.5, y: y + 0.4 }, { x: 0.5, y: y + 1.6 }], '#f2ede0', OUTLINE, 0.5);
}

function drawStone(s: Surface): void {
  const { ctx, w, h } = s;
  circle(ctx, w / 2, h / 2, w / 2 - 1.2, C.stone, OUTLINE, 1);
  circle(ctx, w / 2 - 1, h / 2 - 1, 1.1, C.stoneLight, null);
}

/** Fire stream (frame `f` of 3): narrow and white-hot at the nozzle (left), wide and ragged at the head (right). */
function drawStream(s: Surface, f: number): void {
  const { ctx, w, h } = s;
  const r = mulberry(300 + f);
  const cy = h / 2;
  const layer = (k: number, fill: string): void => {
    const pts: Pt[] = [];
    const steps = 8;
    for (let i = 0; i <= steps; i++) {
      const x = (i / steps) * (w - 1);
      const half = (0.6 + (i / steps) * (h / 2 - 1)) * k * (0.8 + 0.4 * r());
      pts.push({ x, y: cy - half });
    }
    for (let i = steps; i >= 0; i--) {
      const x = (i / steps) * (w - 1);
      const half = (0.6 + (i / steps) * (h / 2 - 1)) * k * (0.8 + 0.4 * r());
      pts.push({ x, y: cy + half });
    }
    poly(ctx, pts, fill, null);
  };
  layer(1, FLAME_OUTER);
  layer(0.66, FLAME_MID);
  layer(0.33, FLAME_IN);
}

/** Rubble of a destroyed building with footprint `fp` (variant `v`): scorched ground, broken stone and charred beams. */
function drawRubble(s: Surface, fp: number, v: number): void {
  const { ctx, w } = s;
  const r = mulberry(4000 + fp * 31 + v * 977);
  const cx = w / 2;
  const cy = fp * 16 + 8; // footprint centre (anchor)
  const hx = fp * 32;
  const hy = fp * 16;
  // Scorched, trampled ground over the footprint diamond.
  ctx.save();
  ctx.globalAlpha = 0.55;
  poly(ctx, [{ x: cx, y: cy - hy }, { x: cx + hx, y: cy }, { x: cx, y: cy + hy }, { x: cx - hx, y: cy }], '#2f2619', null);
  ctx.globalAlpha = 0.35;
  poly(ctx, [{ x: cx, y: cy - hy * 0.7 }, { x: cx + hx * 0.7, y: cy }, { x: cx, y: cy + hy * 0.7 }, { x: cx - hx * 0.7, y: cy }], '#15110b', null);
  ctx.restore();
  // Points inside the diamond, drawn back to front.
  const items: { x: number; y: number; kind: number; s: number }[] = [];
  const count = 8 + fp * 7;
  for (let i = 0; i < count; i++) {
    const u = r() * 2 - 1;
    const q = r() * 2 - 1;
    const a = u * 0.8;
    const b = q * 0.8;
    items.push({ x: cx + (a - b) * hx * 0.5, y: cy + (a + b) * hy * 0.5, kind: r() < 0.28 ? 1 : r() < 0.12 ? 2 : 0, s: 0.7 + r() * 0.8 });
  }
  items.sort((p, q) => p.y - q.y);
  const stones = [C.stone, C.stoneLight, C.stoneDark, C.wallDark, '#8f8778'];
  for (const it of items) {
    if (it.kind === 1) {
      // A charred beam lying at an angle.
      const a = r() * Math.PI;
      const len = 7 + r() * 9;
      const dx = Math.cos(a) * len * 0.5;
      const dy = Math.sin(a) * len * 0.25;
      line(ctx, { x: it.x - dx, y: it.y - dy }, { x: it.x + dx, y: it.y + dy }, OUTLINE, 3.6);
      line(ctx, { x: it.x - dx, y: it.y - dy }, { x: it.x + dx, y: it.y + dy }, r() < 0.5 ? '#3b2a1c' : C.woodDark, 2.2);
    } else if (it.kind === 2) {
      // Glowing embers.
      circle(ctx, it.x, it.y, 1.2, FLAME_MID, null);
    } else {
      // A broken block.
      const sz = 2.2 * it.s + 1.2;
      const fill = stones[Math.floor(r() * stones.length)]!;
      poly(
        ctx,
        [
          { x: it.x - sz, y: it.y },
          { x: it.x - sz * 0.4, y: it.y - sz * 0.9 },
          { x: it.x + sz * 0.7, y: it.y - sz * 0.7 },
          { x: it.x + sz, y: it.y + sz * 0.1 },
          { x: it.x + sz * 0.2, y: it.y + sz * 0.6 },
        ],
        fill,
        OUTLINE,
        0.7,
      );
    }
  }
}

const many = (n: number, make: (f: number) => Surface): Surface[] => Array.from({ length: n }, (_, f) => make(f));

/** Draw every frame of an effect sprite. */
export function drawEffect(id: EffectSpriteId): EffectArt {
  switch (id) {
    case 'projectile.arrow': {
      const s = makeSurface(12, 5);
      drawArrow(s);
      return { frames: [[s]], anchor: { x: 0.5, y: 0.5 }, frameMs: 0, loop: true };
    }
    case 'projectile.stone': {
      const s = makeSurface(9, 9);
      drawStone(s);
      return { frames: [[s]], anchor: { x: 0.5, y: 0.5 }, frameMs: 0, loop: true };
    }
    case 'projectile.fire':
      return {
        frames: [
          many(3, (f) => {
            const s = makeSurface(32, 10);
            drawStream(s, f);
            return s;
          }),
        ],
        anchor: { x: 0, y: 0.5 },
        frameMs: 70,
        loop: true,
      };
    case 'fx.hit':
      return {
        frames: [
          many(4, (f) => {
            const s = makeSurface(16, 14);
            drawHit(s, f, 4);
            return s;
          }),
        ],
        anchor: { x: 0.5, y: 0.5 },
        frameMs: 50,
        loop: false,
      };
    case 'fx.dust':
      return {
        frames: [
          many(6, (f) => {
            const s = makeSurface(44, 30);
            drawDust(s, f, 6);
            return s;
          }),
        ],
        anchor: { x: 0.5, y: 0.72 },
        frameMs: 90,
        loop: false,
      };
    case 'fx.splash':
      return {
        frames: [
          many(5, (f) => {
            const s = makeSurface(26, 20);
            drawSplash(s, f, 5);
            return s;
          }),
        ],
        anchor: { x: 0.5, y: 0.7 },
        frameMs: 70,
        loop: false,
      };
    case 'fx.fireSmall':
    case 'fx.fireLarge': {
      // Pixel flames over a soot scorch, quantised to the shared palette (fire.ts). The anchor is the flames' foot.
      const spec = id === 'fx.fireLarge' ? FIRE_LARGE : FIRE_SMALL;
      const pal = firePalette();
      return {
        frames: [many(FIRE_FRAMES, (f) => surfaceOf(firePixels(spec, f, FIRE_FRAMES, pal)))],
        anchor: { x: 0.5, y: (spec.h - spec.base) / spec.h },
        frameMs: FIRE_FRAME_MS,
        loop: true,
      };
    }
    case 'fx.smoke': {
      const pal = firePalette();
      return {
        frames: [many(SMOKE_FRAMES, (f) => surfaceOf(smokePixels(f, SMOKE_FRAMES, pal)))],
        anchor: { x: 0.5, y: (SMOKE.h - 4) / SMOKE.h },
        frameMs: SMOKE_FRAME_MS,
        loop: true,
      };
    }
    case 'rubble.2':
    case 'rubble.3':
    case 'rubble.4': {
      const fp = Number(id.slice(7));
      const variants = [0, 1].map((v) => {
        const s = makeSurface(fp * 64 + 16, fp * 32 + 16);
        drawRubble(s, fp, v);
        return [s];
      });
      return { frames: variants, anchor: { x: 0.5, y: (fp * 16 + 8) / (fp * 32 + 16) }, frameMs: 0, loop: false };
    }
  }
}
