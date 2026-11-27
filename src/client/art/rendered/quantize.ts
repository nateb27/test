/**
 * The shared 256-colour palette: 240 colours fitted to representative renders (median cut, checked in as
 * paletteData.ts by `npm run art:palette`) plus a 16-step ramp of the player's colour. Every sprite and the terrain
 * are reduced to it with serpentine Floyd-Steinberg error diffusion.
 */

import ART_CONSTANTS from './artConstants.json';
import { PALETTE_RGB } from './paletteData';

/** Shades in a player-colour ramp (shared with the offline sprite pipeline through artConstants.json). */
export const TEAM_LEVELS: number = ART_CONSTANTS.team.levels;
/** Display luminance of the brightest team-cloth level. */
export const TEAM_LUM_DIVISOR: number = ART_CONSTANTS.team.lumDivisor;
const CW = ART_CONSTANTS.palette.channelWeights;
/** Colours fitted to the art (the rest of the 256 are the team ramp). */
export const SHARED_COLOURS = 256 - TEAM_LEVELS;
export const DITHER: number = ART_CONSTANTS.palette.dither;

/** Nearest-colour lookup with a 6-bit-per-channel cache. */
export class Quantizer {
  readonly pal: Uint8Array;
  readonly n: number;
  private readonly cache: Int16Array;

  constructor(pal: ArrayLike<number>) {
    this.pal = Uint8Array.from(pal);
    this.n = Math.floor(this.pal.length / 3);
    this.cache = new Int16Array(262144).fill(-1);
  }

  nearest(r: number, g: number, b: number): number {
    const ri = r < 0 ? 0 : r > 255 ? 255 : r | 0;
    const gi = g < 0 ? 0 : g > 255 ? 255 : g | 0;
    const bi = b < 0 ? 0 : b > 255 ? 255 : b | 0;
    const key = ((ri >> 2) << 12) | ((gi >> 2) << 6) | (bi >> 2);
    let c = this.cache[key]!;
    if (c >= 0) return c;
    const p = this.pal;
    let bd = Infinity;
    // Search from the cell centre so the cache entry is fair for the whole cell.
    const cr = (ri & ~3) + 2;
    const cg = (gi & ~3) + 2;
    const cb = (bi & ~3) + 2;
    for (let q = 0; q < this.n; q++) {
      const dr = p[q * 3]! - cr;
      const dg = p[q * 3 + 1]! - cg;
      const db = p[q * 3 + 2]! - cb;
      const dd = dr * dr * CW[0]! + dg * dg * CW[1]! + db * db * CW[2]!;
      if (dd < bd) {
        bd = dd;
        c = q;
      }
    }
    this.cache[key] = c;
    return c;
  }
}

let shared: Quantizer | null = null;
/** The checked-in palette, or null before one has been generated. */
export function sharedQuantizer(): Quantizer | null {
  if (PALETTE_RGB.length < 3) return null;
  shared ??= new Quantizer(PALETTE_RGB);
  return shared;
}

/**
 * Reduce the pixels where `mask` is non-zero to the palette in place, diffusing the error only between masked
 * pixels (transparent neighbours neither give nor take error, so silhouettes keep clean edges).
 * `rgb` is w*h*3 floats in 0..255, written back with palette colours.
 */
export function ditherMasked(rgb: Float32Array, mask: Uint8Array, w: number, h: number, q: Quantizer, amount = DITHER): void {
  const p = q.pal;
  for (let y = 0; y < h; y++) {
    const rev = (y & 1) === 1;
    const sd = rev ? -1 : 1;
    for (let xx = 0; xx < w; xx++) {
      const x = rev ? w - 1 - xx : xx;
      const i = x + w * y;
      if (!mask[i]) continue;
      const r = rgb[i * 3]!;
      const g = rgb[i * 3 + 1]!;
      const b = rgb[i * 3 + 2]!;
      const c = q.nearest(r, g, b);
      const pr = p[c * 3]!;
      const pg = p[c * 3 + 1]!;
      const pb = p[c * 3 + 2]!;
      rgb[i * 3] = pr;
      rgb[i * 3 + 1] = pg;
      rgb[i * 3 + 2] = pb;
      const er = (r - pr) * amount;
      const eg = (g - pg) * amount;
      const eb = (b - pb) * amount;
      const push = (xq: number, yq: number, wt: number): void => {
        if (xq < 0 || xq >= w || yq >= h) return;
        const j = xq + w * yq;
        if (!mask[j]) return;
        rgb[j * 3] = rgb[j * 3]! + er * wt;
        rgb[j * 3 + 1] = rgb[j * 3 + 1]! + eg * wt;
        rgb[j * 3 + 2] = rgb[j * 3 + 2]! + eb * wt;
      };
      push(x + sd, y, 7 / 16);
      push(x - sd, y + 1, 3 / 16);
      push(x, y + 1, 5 / 16);
      push(x + sd, y + 1, 1 / 16);
    }
  }
}

/**
 * Median cut over a 15-bit histogram (5 bits per channel) into at most `ncol` colours, weighted towards green
 * (where the eye and the grass need the most steps). Returns ncol*3 bytes.
 */
export function medianCut(hist: Uint32Array, ncol: number): Uint8Array {
  const bins: number[] = [];
  for (let i = 0; i < 32768; i++) if (hist[i]) bins.push(i);
  const ch = (c: number, k: number): number => (k === 0 ? c >> 10 : k === 1 ? (c >> 5) & 31 : c & 31);
  const boxes: number[][] = [bins];
  const wts = [1.0, 1.2, 0.8];
  while (boxes.length < ncol) {
    let bi = -1;
    let bs = -1;
    let bk = 0;
    for (let q = 0; q < boxes.length; q++) {
      const bx = boxes[q]!;
      if (bx.length < 2) continue;
      let cnt = 0;
      const mn = [31, 31, 31];
      const mx = [0, 0, 0];
      for (const c of bx) {
        cnt += hist[c]!;
        for (let k = 0; k < 3; k++) {
          const v = ch(c, k);
          if (v < mn[k]!) mn[k] = v;
          if (v > mx[k]!) mx[k] = v;
        }
      }
      for (let k = 0; k < 3; k++) {
        const sc = (mx[k]! - mn[k]!) * wts[k]! * Math.sqrt(cnt);
        if (sc > bs) {
          bs = sc;
          bi = q;
          bk = k;
        }
      }
    }
    if (bi < 0) break;
    const bx = boxes[bi]!.sort((a, b) => ch(a, bk) - ch(b, bk));
    let tot = 0;
    for (const c of bx) tot += hist[c]!;
    let acc = 0;
    let cut = 1;
    for (let q = 0; q < bx.length; q++) {
      acc += hist[bx[q]!]!;
      if (acc >= tot / 2) {
        cut = Math.max(1, Math.min(bx.length - 1, q + 1));
        break;
      }
    }
    boxes.splice(bi, 1, bx.slice(0, cut), bx.slice(cut));
  }
  const out = new Uint8Array(boxes.length * 3);
  boxes.forEach((bx, q) => {
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (const c of bx) {
      const w = hist[c]!;
      r += ((c >> 10) * 8 + 4) * w;
      g += (((c >> 5) & 31) * 8 + 4) * w;
      b += ((c & 31) * 8 + 4) * w;
      n += w;
    }
    out[q * 3] = Math.round(r / Math.max(1, n));
    out[q * 3 + 1] = Math.round(g / Math.max(1, n));
    out[q * 3 + 2] = Math.round(b / Math.max(1, n));
  });
  return out;
}

/** Add opaque pixels (RGB 0..255) to a 15-bit histogram. */
export function addToHistogram(hist: Uint32Array, rgb: ArrayLike<number>, stride: number, mask?: ArrayLike<number>): void {
  const n = Math.floor(rgb.length / stride);
  for (let i = 0; i < n; i++) {
    if (mask !== undefined && !mask[i]) continue;
    const r = Math.max(0, Math.min(255, rgb[i * stride]!)) >> 3;
    const g = Math.max(0, Math.min(255, rgb[i * stride + 1]!)) >> 3;
    const b = Math.max(0, Math.min(255, rgb[i * stride + 2]!)) >> 3;
    hist[(r << 10) | (g << 5) | b]!++;
  }
}

/** Brightness of a rendered team-cloth pixel as a ramp level 0..TEAM_LEVELS-1. */
export function teamLevel(r: number, g: number, b: number): number {
  const lum = 0.3 * r + 0.59 * g + 0.11 * b;
  const t = Math.max(0, Math.min(0.999, lum / TEAM_LUM_DIVISOR));
  return Math.floor(t * TEAM_LEVELS);
}

/** The 16 display colours of a player-colour ramp (0xRRGGBB), dark to light. */
export function teamRamp(primary: number): Uint8Array {
  const pr = (primary >> 16) & 255;
  const pg = (primary >> 8) & 255;
  const pb = primary & 255;
  // Lift very dark team colours so the cloth still reads in shade.
  const lum = 0.3 * pr + 0.59 * pg + 0.11 * pb;
  const lift = lum < 90 ? 90 / Math.max(20, lum) : 1;
  const out = new Uint8Array(TEAM_LEVELS * 3);
  for (let i = 0; i < TEAM_LEVELS; i++) {
    const t = (i + 0.5) / TEAM_LEVELS;
    const k = 0.12 + t * 1.25;
    const base = Math.min(k, 1) * Math.min(1.6, lift);
    const hi = Math.max(0, k - 1) * 0.55;
    const c = (v: number): number => Math.max(0, Math.min(255, Math.round(v * base + (255 - v * base) * hi)));
    out[i * 3] = c(pr);
    out[i * 3 + 1] = c(pg);
    out[i * 3 + 2] = c(pb);
  }
  return out;
}
