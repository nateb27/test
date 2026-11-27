/**
 * Procedural effect art (PLAN-M2 3.8, WP27): projectiles, hit effects, building fire and smoke, and rubble. Drawn to
 * canvases once at load like the rest of the procedural art; colours are kept close to the rendered art's palette
 * (warm fire, grey-brown dust and stone) so the same sprites serve both art modes. Nothing here is team coloured.
 *
 * Every drawing is deterministic (`mulberry` with a fixed seed), so the art is identical on every load.
 */

import type { EffectSpriteId } from './catalog';
import { circle, ellipse, line, makeSurface, mulberry, poly, type Ctx, type Pt, type Surface } from './draw';
import { C, OUTLINE } from './palette';

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

/** A flame tongue: a teardrop from a base point up to a tip, bent by `lean`. */
function tongue(ctx: Ctx, x: number, base: number, w: number, h: number, lean: number, fill: string): void {
  ctx.beginPath();
  ctx.moveTo(x - w / 2, base);
  ctx.bezierCurveTo(x - w / 2, base - h * 0.45, x + lean - w * 0.15, base - h * 0.7, x + lean, base - h);
  ctx.bezierCurveTo(x + lean + w * 0.15, base - h * 0.7, x + w / 2, base - h * 0.45, x + w / 2, base);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

/** A looping fire of `w` x `h` (frame `f` of 4): three nested layers of flickering tongues over embers. */
function drawFire(s: Surface, f: number, big: boolean): void {
  const { ctx, w, h } = s;
  const r = mulberry(1000 + f * 17 + (big ? 7 : 0));
  const base = h - 2;
  const n = big ? 4 : 3;
  ctx.save();
  ctx.globalAlpha = 0.55;
  ellipse(ctx, w / 2, base, w * 0.42, 2.2, '#3a1606', null);
  ctx.restore();
  for (const [scale, fill] of [
    [1, FLAME_OUTER],
    [0.7, FLAME_MID],
    [0.42, FLAME_IN],
  ] as const) {
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const x = w * (0.22 + 0.56 * t) + (r() - 0.5) * 1.5;
      const hh = (h - 4) * scale * (0.55 + 0.45 * Math.sin((t + 0.15) * Math.PI)) * (0.85 + 0.3 * r());
      const ww = (w / n) * 1.5 * scale + 1;
      tongue(ctx, x, base, ww, hh, (r() - 0.5) * w * 0.25, fill);
    }
  }
  // A couple of sparks above the flames.
  for (let i = 0; i < (big ? 3 : 2); i++) circle(ctx, w * (0.25 + 0.5 * r()), base - (h - 4) * (0.75 + 0.3 * r()), 0.6, FLAME_IN, null);
}

/** One frame of a looping smoke column: puffs that rise and grow over the cycle (frame `f` of `n`). */
function drawSmoke(s: Surface, f: number, n: number): void {
  const { ctx, w, h } = s;
  const puffs = 7;
  // Puff k at phase p is where puff k + 1 was a cycle earlier (positions depend on p only), so the loop is seamless.
  // Soft-edged puffs (radial gradients), dark near the fire, paler and thinner as they rise and spread.
  for (let k = puffs - 1; k >= 0; k--) {
    const p = (k + f / n) / puffs; // 0 at the bottom, 1 at the top
    const y = h - 3 - p * (h - 12);
    const x = w / 2 + Math.sin(p * 6) * w * 0.08 + p * w * 0.16;
    const rad = 2.5 + p * (w * 0.32);
    const a = 0.95 * (1 - 0.75 * p) * Math.min(1, p * 5 + 0.5);
    const shade = Math.round(48 + p * 50);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(${shade},${shade - 4},${shade - 8},${a})`);
    g.addColorStop(0.6, `rgba(${shade + 10},${shade + 6},${shade},${a * 0.8})`);
    g.addColorStop(1, `rgba(${shade + 20},${shade + 16},${shade + 10},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }
}

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
      const big = id === 'fx.fireLarge';
      return {
        frames: [
          many(4, (f) => {
            const s = big ? makeSurface(24, 38) : makeSurface(15, 24);
            drawFire(s, f, big);
            return s;
          }),
        ],
        anchor: { x: 0.5, y: (big ? 36 : 22) / (big ? 38 : 24) },
        frameMs: 100,
        loop: true,
      };
    }
    case 'fx.smoke':
      return {
        frames: [
          many(6, (f) => {
            const s = makeSurface(32, 72);
            drawSmoke(s, f, 6);
            return s;
          }),
        ],
        anchor: { x: 0.5, y: 68 / 72 },
        frameMs: 160,
        loop: true,
      };
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
