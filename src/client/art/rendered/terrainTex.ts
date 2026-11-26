/**
 * Terrain textures: grass, dry grass and worn earth, each lit like the sprites and reduced to the shared palette.
 * Every texture repeats every PERIOD tiles in world x and y, which makes its screen image a seamless
 * (64*PERIOD) x (32*PERIOD) rectangle tile: the terrain layer fills chunks with it and picks per pixel which of the
 * textures shows (see render/terrain.ts).
 */

import { LIGHT, toDisplay } from './light';
import { fbm2p, hash3, smooth, vn2p } from './noise';
import { HALF_H, HALF_W } from './project';
import { ditherMasked, sharedQuantizer } from './quantize';

/** World tiles per texture repeat. */
export const PERIOD = 8;
export const TEX_W = 2 * HALF_W * PERIOD;
export const TEX_H = 2 * HALF_H * PERIOD;

export const TERRAIN_KINDS = ['grass', 'dry', 'dirt', 'grass2'] as const;
export type TerrainKind = (typeof TERRAIN_KINDS)[number];

const P = PERIOD;
const wrap = (v: number, n: number): number => ((v % n) + n) % n;
const h2 = (x: number, y: number, px: number, py: number, s: number): number => hash3(wrap(x, px), wrap(y, py), s);

const col = { r: 0, g: 0, b: 0 };
function setc(r: number, g: number, b: number): void {
  col.r = r;
  col.g = g;
  col.b = b;
}
function mixc(r: number, g: number, b: number, t: number): void {
  col.r += (r - col.r) * t;
  col.g += (g - col.g) * t;
  col.b += (b - col.b) * t;
}
function mulc(k: number): void {
  col.r *= k;
  col.g *= k;
  col.b *= k;
}

/** Shade one ground point of a texture kind; returns linear radiance in `lin`. */
function shadeGround(kind: TerrainKind, x: number, y: number, lin: Float32Array, o: number): void {
  const seed = kind === 'grass2' ? 50 : 0;
  const L1 = fbm2p(x * 0.25, y * 0.25, P / 4, 3, 11 + seed);
  const L2 = fbm2p(x * 0.75, y * 0.75, (P * 3) / 4, 3, 23 + seed);
  const F = fbm2p(x * 4, y * 4, P * 4, 2, 37 + seed);
  const Mi = vn2p(x * 19, y * 19, P * 19, 41 + seed);
  const MM = vn2p(x * 47 + 3, y * 47, P * 47, 43 + seed);
  const hb = h2(Math.floor(x * 64), Math.floor(y * 128), P * 64, P * 128, 5 + seed);
  let nx = 0;
  let ny = 0;
  let nz = 1;
  // Grass: olive base, deeper green hollows, straw-dry patches.
  setc(0.29, 0.32, 0.15);
  mixc(0.18, 0.24, 0.1, smooth(0.4, 0.7, L2) * 0.9);
  mixc(0.15, 0.2, 0.09, smooth(0.5, 0.75, F + (L2 - 0.5) * 0.5) * 0.45);
  const dryBase = smooth(0.46, 0.72, L1 * 0.7 + F * 0.3) * LIGHT.dry;
  const dry = kind === 'dry' ? Math.min(1, 0.55 + dryBase * 0.6) : dryBase * 0.55;
  mixc(0.48, 0.43, 0.27, dry * 0.75);
  mixc(0.4, 0.38, 0.22, smooth(0.55, 0.8, F) * 0.35);
  mulc(0.62 + 0.62 * MM * (0.5 + 0.5 * Mi));
  if (hb < 0.14) mulc(0.66);
  else if (hb > 0.94) mixc(0.6, 0.58, 0.38, 0.4);
  let dd = 0;
  if (kind === 'dirt') {
    dd = 1;
    setc(0.44, 0.37, 0.28);
    mixc(0.54, 0.48, 0.38, smooth(0.45, 0.75, L1 + (F - 0.5) * 0.6) * 0.65);
    mixc(0.32, 0.27, 0.2, smooth(0.5, 0.75, F + (Mi - 0.5) * 0.4) * 0.7);
    mixc(0.42, 0.41, 0.36, smooth(0.6, 0.8, L2 + (MM - 0.5) * 0.2) * 0.35);
    mulc(0.8 + 0.28 * MM + 0.14 * (hb - 0.5));
    mulc(1 - 0.12 * smooth(0.55, 0.75, vn2p(x * 6 + y * 2, y * 6 - x * 2, P * 8, 7)));
    // A few surviving tufts.
    const tuft = smooth(0.72, 0.8, vn2p(x * 9, y * 9, P * 9, 61) * 0.7 + Mi * 0.3);
    mixc(0.32, 0.33, 0.17, tuft * 0.7);
  }
  // Bump.
  const bx = vn2p(x * 19 + 0.08, y * 19, P * 19, 41 + seed) - Mi;
  const by = vn2p(x * 19, y * 19 + 0.08, P * 19, 41 + seed) - Mi;
  nx -= bx * 1.6;
  ny -= by * 1.6;
  // Pebbles.
  const cs = 1 / 9;
  const ci = Math.floor(x / cs);
  const cj = Math.floor(y / cs);
  const NC = P * 9;
  const ph = h2(ci + 3, cj * 3, NC, NC * 3, 71 + seed);
  if (ph < 0.012 + 0.11 * dd) {
    const hA = h2(ci, cj + 5, NC, NC, 72);
    const pr = 0.016 + 0.03 * hA * hA + (h2(ci, cj + 6, NC, NC, 73) > 0.93 ? 0.03 : 0);
    const pcx = (ci + 0.3 + 0.4 * h2(ci, cj + 1, NC, NC, 74)) * cs;
    const pcy = (cj + 0.3 + 0.4 * h2(ci, cj + 2, NC, NC, 75)) * cs;
    const dx = (x - pcx) / pr;
    const dy = (y - pcy) / pr;
    const d2 = dx * dx + dy * dy;
    if (d2 < 1) {
      const t = h2(ci, cj + 9, NC, NC, 76);
      setc(0.58 + 0.12 * t, 0.55 + 0.1 * t, 0.49 + 0.06 * t);
      mulc(0.85 + 0.2 * vn2p(x * 200, y * 200, P * 200, 77));
      nx = dx * 0.9;
      ny = dy * 0.9;
      nz = Math.sqrt(Math.max(0.05, 1 - d2));
    } else {
      const sx = dx + (LIGHT.Lx * 0.9) / Math.max(0.2, LIGHT.Lz);
      const sy = dy + (LIGHT.Ly * 0.9) / Math.max(0.2, LIGHT.Lz);
      if (sx * sx + sy * sy < 1.1) mulc(0.62);
    }
  }
  // Sparse flowers on grass.
  if (dd < 0.2) {
    const fs = 0.25;
    const fi = Math.floor(x / fs);
    const fj = Math.floor(y / fs);
    const FN = P * 4;
    if (h2(fi * 5 + 1, fj * 3 + 7, FN * 5, FN * 3, 81 + seed) < (kind === 'dry' ? 0.01 : 0.02)) {
      const fcx = (fi + 0.5) * fs;
      const fcy = (fj + 0.5) * fs;
      if (Math.hypot(x - fcx, y - fcy) < 0.013) {
        const c = h2(fi, fj, FN, FN, 82);
        if (c < 0.4) setc(0.86, 0.84, 0.72);
        else if (c < 0.7) setc(0.85, 0.7, 0.25);
        else if (c < 0.85) setc(0.7, 0.22, 0.16);
        else setc(0.55, 0.45, 0.68);
      }
    }
  }
  const l = Math.hypot(nx, ny, nz);
  nx /= l;
  ny /= l;
  nz /= l;
  const L = LIGHT;
  const ndl = Math.max(0, nx * L.Lx + ny * L.Ly + nz * L.Lz);
  const skyk = 0.6 + 0.4 * nz;
  const bk = 0.5 - 0.5 * nz;
  lin[o] = col.r * col.r * (L.sunCol[0] * ndl + L.skyCol[0] * skyk + L.bounceCol[0] * bk);
  lin[o + 1] = col.g * col.g * (L.sunCol[1] * ndl + L.skyCol[1] * skyk + L.bounceCol[1] * bk);
  lin[o + 2] = col.b * col.b * (L.sunCol[2] * ndl + L.skyCol[2] * skyk + L.bounceCol[2] * bk);
}

export interface TerrainTexOut {
  kind: TerrainKind;
  w: number;
  h: number;
  rgba: Uint8ClampedArray;
  rawRgb?: Float32Array;
}

/** Render one seamless terrain texture. Yields every few rows. */
export function* renderTerrainTex(kind: TerrainKind, raw = false): Generator<void, TerrainTexOut, void> {
  const w = TEX_W;
  const h = TEX_H;
  const rgb = new Float32Array(w * h * 3);
  const lin = new Float32Array(3);
  const ss = 1;
  const acc = [0, 0, 0];
  const tmp = [0, 0, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      acc[0] = acc[1] = acc[2] = 0;
      for (let j = 0; j < ss; j++) {
        for (let i = 0; i < ss; i++) {
          const sx = x + (i + 0.5) / ss;
          const sy = y + (j + 0.5) / ss;
          const a = sx / HALF_W;
          const b = sy / HALF_H;
          shadeGround(kind, (a + b) / 2, (b - a) / 2, lin, 0);
          acc[0]! += lin[0]!;
          acc[1]! += lin[1]!;
          acc[2]! += lin[2]!;
        }
      }
      toDisplay(acc[0]! / (ss * ss), acc[1]! / (ss * ss), acc[2]! / (ss * ss), tmp);
      const o = (x + w * y) * 3;
      rgb[o] = tmp[0]!;
      rgb[o + 1] = tmp[1]!;
      rgb[o + 2] = tmp[2]!;
    }
    if (y % 16 === 0) yield;
  }
  const rawRgb = raw ? rgb.slice() : undefined;
  const q = sharedQuantizer();
  if (q !== null && !raw) ditherMasked(rgb, new Uint8Array(w * h).fill(1), w, h, q);
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = rgb[i * 3]!;
    rgba[i * 4 + 1] = rgb[i * 3 + 1]!;
    rgba[i * 4 + 2] = rgb[i * 3 + 2]!;
    rgba[i * 4 + 3] = 255;
  }
  const res: TerrainTexOut = { kind, w, h, rgba };
  if (rawRgb !== undefined) res.rawRgb = rawRgb;
  return res;
}
