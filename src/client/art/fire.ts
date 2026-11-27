/**
 * Building fire, smoke and soot as pixel art (WP34): computed pixel by pixel at the art's own resolution (one texel
 * per screen pixel at 1x, like the voxel buildings and the sheet units), animated by a turbulence field that scrolls
 * upwards and loops seamlessly, and reduced to the shared 256-colour palette with an ordered (Bayer) dither, which
 * stays still from frame to frame where the field does (error diffusion would shimmer). The palette's warm end is
 * a gritty ramp (deep red-brown, rust, ochre, gold, hot white), so the flames sit in the same picture as the
 * buildings instead of the flat bright shapes they replaced.
 *
 * Pure functions over plain arrays (no canvas), so they are unit-tested in node; `fx.ts` copies them to canvases.
 * Every value is deterministic: the same frames on every load.
 */

/** What the palette quantizer offers (`rendered/quantize.ts` `Quantizer`). */
export interface PaletteLookup {
  readonly pal: ArrayLike<number>;
  nearest(r: number, g: number, b: number): number;
}

/** RGBA pixels of one frame, `w * h * 4` bytes, row-major. */
export interface PixelFrame {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8ClampedArray;
}

// ---------------------------------------------------------------------------------------------------------------
// Noise: value noise on an integer lattice, periodic in y, so a field scrolled by exactly one period loops.
// ---------------------------------------------------------------------------------------------------------------

function hash(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Value noise in [0, 1), periodic in y with integer period `py`. */
export function periodicNoise(x: number, y: number, py: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const wrap = (iy: number): number => ((iy % py) + py) % py;
  const a = hash(x0, wrap(y0), seed);
  const b = hash(x0 + 1, wrap(y0), seed);
  const c = hash(x0, wrap(y0 + 1), seed);
  const d = hash(x0 + 1, wrap(y0 + 1), seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Three octaves of `periodicNoise`, still periodic in y with period `py` (every octave's period divides it). */
export function periodicFbm(x: number, y: number, py: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < 3; o++) {
    sum += periodicNoise(x * f, y * f, py * f, seed + o * 101) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

// ---------------------------------------------------------------------------------------------------------------
// Palette reduction
// ---------------------------------------------------------------------------------------------------------------

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Write palette colour of (r, g, b) with an ordered dither at pixel (x, y), alpha `a`, into `out`. */
function put(out: Uint8ClampedArray, w: number, x: number, y: number, r: number, g: number, b: number, a: number, pal: PaletteLookup, spread: number): void {
  const t = (BAYER4[(y & 3) * 4 + (x & 3)]! + 0.5) / 16 - 0.5;
  const q = pal.nearest(r + t * spread, g + t * spread, b + t * spread);
  const i = (y * w + x) * 4;
  out[i] = pal.pal[q * 3]!;
  out[i + 1] = pal.pal[q * 3 + 1]!;
  out[i + 2] = pal.pal[q * 3 + 2]!;
  out[i + 3] = a;
}

/** The fire's colour by heat 0..1: soot-dark red, rust, orange-ochre, gold, hot white (targets; the palette decides). */
const FIRE_RAMP: readonly (readonly [number, number, number, number])[] = [
  [0.0, 52, 20, 10],
  [0.24, 112, 38, 16],
  [0.48, 176, 78, 30],
  [0.68, 222, 132, 46],
  [0.86, 244, 192, 80],
  [1.0, 255, 240, 200],
];

function ramp(stops: readonly (readonly [number, number, number, number])[], t: number): [number, number, number] {
  const v = Math.max(0, Math.min(1, t));
  for (let i = 1; i < stops.length; i++) {
    const b = stops[i]!;
    if (v <= b[0]) {
      const a = stops[i - 1]!;
      const k = (v - a[0]) / Math.max(1e-6, b[0] - a[0]);
      return [a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k];
    }
  }
  const z = stops[stops.length - 1]!;
  return [z[1], z[2], z[3]];
}

// ---------------------------------------------------------------------------------------------------------------
// Fire
// ---------------------------------------------------------------------------------------------------------------

export interface FireSpec {
  w: number;
  h: number;
  /** Rows below the flames' base kept for the ember bed and the soot. */
  base: number;
  /** Turbulence cells across and up (bigger fires have finer, busier flames). */
  cellX: number;
  cellY: number;
  seed: number;
}

export const FIRE_SMALL: FireSpec = { w: 20, h: 30, base: 4, cellX: 4.2, cellY: 5.5, seed: 11 };
export const FIRE_LARGE: FireSpec = { w: 34, h: 52, base: 5, cellX: 4.8, cellY: 7, seed: 23 };

/** Turbulence periods: the field scrolls `PERIOD` lattice cells upwards over one loop. */
const PERIOD = 4;
/** Flames and sparks stay below this fraction of the flame height (the rows above hold soot only). */
const FLAME_TOP = 0.9;

/**
 * Frame `f` of `n` of a looping fire: soot scorched into the wall around and above the flames (static, so it reads as
 * a mark on the building), an ember bed at the foot, ragged tongues of flame with ember-coloured cores, a few sparks.
 */
export function firePixels(spec: FireSpec, f: number, n: number, pal: PaletteLookup): PixelFrame {
  const { w, h, base, cellX, cellY, seed } = spec;
  const out = new Uint8ClampedArray(w * h * 4);
  const t = f / n;
  const baseY = h - base; // flame foot row
  const flameH = baseY - 1;
  const cx = w / 2;

  // Soot: an irregular dark scorch, wider than the fire and running up the wall above it. Static over the loop.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5 - cx) / (w * 0.5);
      const v = (baseY + 1 - y) / (h * 0.98); // 0 at the foot, 1 at the top
      // A plume-shaped scorch: about the fire's width at the foot, licking up the wall in streaks.
      const streak = (periodicNoise(x / 1.6, y / 9, 1 << 16, seed + 3) - 0.5) * 0.5;
      const width = 0.78 - 0.35 * Math.max(0, v) + streak * Math.max(0, v);
      const edge = (periodicNoise(x / 2.3, y / 2.3, 1 << 16, seed + 7) - 0.5) * 0.4;
      const d = Math.abs(u) / Math.max(0.05, width) + Math.max(0, -v) * 6 + Math.max(0, v - 0.55) * 1.6 + edge;
      if (d >= 1 || v > 1) continue;
      const dark = 1 - d;
      const shade = 20 + 24 * (1 - dark);
      // Denser soot near the middle; ordered alpha steps keep it pixel-crisp.
      const a = dark > 0.5 ? 200 : dark > 0.22 ? 140 : 90;
      put(out, w, x, y, shade + 6, shade, shade - 6, a, pal, 10);
    }
  }

  // Flames.
  for (let y = 0; y < baseY + 2 && y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = (baseY - y) / flameH; // 0 at the foot, 1 at the top
      // The top rows are soot only: the flames lick up to 90% of the sprite.
      if (v < -0.12 || v > FLAME_TOP) continue;
      const u = (x + 0.5 - cx) / (w * 0.5);
      const ny = y / cellY + t * PERIOD;
      // Narrow columns of turbulence (finer across than up) split the fire into tongues. Both fields scroll by
      // exactly their period over the loop, so the last frame runs into the first.
      const n1 = periodicFbm(x / (cellX * 0.7), ny, PERIOD, seed);
      const n2 = periodicFbm(x / cellX + 17.3, ny + 3.1, PERIOD, seed + 50);
      // Tongues sway sideways more the higher they reach.
      const us = u + (n2 - 0.5) * 0.8 * Math.max(0, v);
      const vv = Math.max(0, v);
      const width = 0.66 * Math.pow(1 - Math.min(1, vv), 0.85) + 0.1;
      const across = 1 - Math.abs(us) / width;
      if (across <= 0) continue;
      let heat = across * (1.02 - vv * 1.08) + (n1 - 0.5) * (0.95 + vv * 1.15) - vv * 0.22;
      // The ember bed: hot and steady at the foot.
      if (v < 0.1) heat = Math.max(heat, across * 0.78 * (1 - Math.abs(v) * 4) + (n1 - 0.5) * 0.35);
      if (heat <= 0.08) continue;
      const k = Math.min(1, (heat - 0.04) / 0.92);
      const [r, g, b] = ramp(FIRE_RAMP, k);
      // Outermost licks a little see-through; the rest opaque, like the sprites around it.
      put(out, w, x, y, r, g, b, k < 0.12 ? 190 : 255, pal, 28);
    }
  }

  // Sparks: single hot pixels rising through the loop, each on its own track.
  const sparks = Math.max(2, Math.round(w / 9));
  for (let s = 0; s < sparks; s++) {
    const phase = (hash(s, 3, seed) + t) % 1;
    const sx = Math.round(cx + (hash(s, 5, seed) - 0.5) * w * 0.5 + Math.sin((phase + s) * 6.28) * 1.5);
    const sy = Math.round(baseY - flameH * (0.5 + phase * 0.65));
    if (sx < 0 || sx >= w || sy < 0 || sy >= h || phase > 0.6) continue;
    put(out, w, sx, sy, 250, 214, 120, 255, pal, 0);
  }
  return { w, h, data: out };
}

// ---------------------------------------------------------------------------------------------------------------
// Smoke
// ---------------------------------------------------------------------------------------------------------------

export const SMOKE = { w: 36, h: 80, seed: 41 } as const;

/**
 * Frame `f` of `n` of a looping smoke column: dark, sooty billows near the fire that rise, widen, drift and thin out.
 * Alpha comes in a few steps chosen by an ordered threshold, so the smoke stays pixel art over the scene.
 */
export function smokePixels(f: number, n: number, pal: PaletteLookup): PixelFrame {
  const { w, h, seed } = SMOKE;
  const out = new Uint8ClampedArray(w * h * 4);
  const t = f / n;
  const foot = h - 4;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = (foot - y) / (foot - 2); // 0 at the fire, 1 at the top
      if (v < 0 || v > 1) continue;
      const drift = v * v * w * 0.22; // the wind leans the column
      const u = (x + 0.5 - w / 2 - drift) / (w * 0.5);
      const width = 0.3 + 0.62 * Math.pow(v, 0.6);
      const ny = y / 7 + t * PERIOD;
      const billow = periodicFbm(x / 6, ny, PERIOD, seed);
      const density = (1 - Math.abs(u) / width) * 1.35 + (billow - 0.5) * 1.2 - v * 0.55;
      if (density <= 0) continue;
      const d = Math.min(1, density);
      const shade = 30 + 40 * v + 14 * (1 - d); // dark near the fire, ashen higher up
      const bayer = (BAYER4[(y & 3) * 4 + (x & 3)]! + 0.5) / 16;
      // Coverage thins with height; pixels below the threshold are left out (ordered transparency).
      const cover = Math.min(1, d * 1.4) * (1 - v * 0.5);
      if (cover < bayer * 0.35) continue;
      const a = cover > 0.6 ? 225 : cover > 0.3 ? 180 : 130;
      put(out, w, x, y, shade + 4, shade + 2, shade - 2, a, pal, 8);
    }
  }
  return { w, h, data: out };
}
