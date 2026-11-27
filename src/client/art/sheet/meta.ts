/**
 * Frame metadata of the pre-rendered sprite sheets (`src/client/art/sheets/<name>.json`, written by
 * `scripts/art/pipeline/pack.py`), its validation, and the index-range rules of the sheets' palettes.
 */

import type { IndexedPng } from './png';

/**
 * One frame: [page, x, y, w, h, offX, offY, bodyX0, bodyY0, bodyX1, bodyY1]. (x, y, w, h) is the trimmed rect on
 * the page; (offX, offY) where it sits in the untrimmed frame (`SheetMeta.size`); the body box (figure pixels only,
 * no shadow) is in untrimmed frame pixels too.
 */
export type SheetFrame = readonly [number, number, number, number, number, number, number, number, number, number, number];

export interface SheetState {
  readonly frames: number;
  readonly facings: number;
  /** Milliseconds per frame (0 for stills). */
  readonly ms: number;
  readonly loop: boolean;
  /** Locomotion: ground distance in tiles covered by one loop (frames advance with distance travelled). */
  readonly cycle?: number;
  /** facings * frames entries, facing-major (index = facing * frames + frame). */
  readonly f: readonly SheetFrame[];
}

export interface SheetMeta {
  readonly version: number;
  readonly name: string;
  /** Untrimmed frame size and ground anchor, px. */
  readonly size: readonly [number, number];
  readonly anchor: readonly [number, number];
  readonly pages: readonly string[];
  /** [first index, count] of the palette ranges. */
  readonly shadow: readonly [number, number];
  readonly outline: readonly [number, number];
  readonly team: readonly [number, number];
  readonly states: Readonly<Record<string, SheetState>>;
  /** Trees and bushes: number of looks, states `v0`..`v{n-1}`. */
  readonly variants?: number;
  /** Units: HUD portrait rendered larger, [page, x, y, w, h] (figure layer). */
  readonly icon?: readonly [number, number, number, number, number];
}

/** Problems with a sheet's metadata (empty when it is valid). `pages` are the decoded pages, when available. */
export function validateSheet(meta: SheetMeta, pages?: readonly { width: number; height: number }[]): string[] {
  const errs: string[] = [];
  const [W, H] = meta.size;
  if (!(W > 0 && H > 0)) errs.push(`${meta.name}: bad size`);
  const [ax, ay] = meta.anchor;
  if (!(ax >= 0 && ax <= W && ay >= 0 && ay <= H)) errs.push(`${meta.name}: anchor outside the frame`);
  if (meta.pages.length === 0) errs.push(`${meta.name}: no pages`);
  const ranges = [meta.shadow, meta.outline, meta.team];
  for (const [a, n] of ranges) if (!(a >= 1 && n >= 1 && a + n <= 256)) errs.push(`${meta.name}: bad palette range`);
  if (meta.icon !== undefined) {
    const [pg, x, y, w, h] = meta.icon;
    const page = pages?.[pg];
    if (pg < 0 || pg >= meta.pages.length || w <= 0 || h <= 0 || (page !== undefined && (x + w > page.width || y + h > page.height))) errs.push(`${meta.name}: bad icon rect`);
  }
  for (const [name, st] of Object.entries(meta.states)) {
    if (st.f.length !== st.frames * st.facings) errs.push(`${meta.name}.${name}: ${st.f.length} frames, expected ${st.frames * st.facings}`);
    st.f.forEach((fr, i) => {
      if (fr === null || fr.length !== 11) {
        errs.push(`${meta.name}.${name}[${i}]: missing`);
        return;
      }
      const [pg, x, y, w, h, ox, oy, bx0, by0, bx1, by1] = fr;
      if (pg < 0 || pg >= meta.pages.length) errs.push(`${meta.name}.${name}[${i}]: bad page`);
      const page = pages?.[pg];
      if (page !== undefined && (x < 0 || y < 0 || x + w > page.width || y + h > page.height)) errs.push(`${meta.name}.${name}[${i}]: rect outside page`);
      if (w <= 0 || h <= 0 || ox < 0 || oy < 0 || ox + w > W || oy + h > H) errs.push(`${meta.name}.${name}[${i}]: rect outside frame`);
      if (!(bx0 < bx1 && by0 < by1 && bx0 >= 0 && by0 >= 0 && bx1 <= W && by1 <= H)) errs.push(`${meta.name}.${name}[${i}]: bad body box`);
    });
  }
  return errs;
}

export type SheetLayer = 'figure' | 'shadow';

/**
 * RGBA pixels of one layer of a decoded page. Figure: colours, outline and team pixels (team re-coloured with
 * `ramp`, 16 x RGB, or left at the PNG's reference colours when null). Shadow: the ground-shadow pixels only.
 */
export function layerPixels(png: IndexedPng, meta: SheetMeta, layer: SheetLayer, ramp: Uint8Array | null): Uint8ClampedArray<ArrayBuffer> {
  const { indices, palette, alpha } = png;
  const out = new Uint8ClampedArray(new ArrayBuffer(indices.length * 4));
  const [s0, sn] = meta.shadow;
  const [t0, tn] = meta.team;
  // Per-index colour table for this layer.
  const lut = new Uint8Array(256 * 4);
  for (let i = 1; i < 256; i++) {
    const isShadow = i >= s0 && i < s0 + sn;
    if ((layer === 'shadow') !== isShadow) continue;
    let r = palette[i * 3]!;
    let g = palette[i * 3 + 1]!;
    let b = palette[i * 3 + 2]!;
    if (layer === 'figure' && ramp !== null && i >= t0 && i < t0 + tn) {
      const lv = i - t0;
      r = ramp[lv * 3]!;
      g = ramp[lv * 3 + 1]!;
      b = ramp[lv * 3 + 2]!;
    }
    lut[i * 4] = r;
    lut[i * 4 + 1] = g;
    lut[i * 4 + 2] = b;
    lut[i * 4 + 3] = alpha[i]!;
  }
  for (let p = 0; p < indices.length; p++) {
    const i = indices[p]!;
    if (i === 0) continue;
    const q = i * 4;
    const o = p * 4;
    out[o] = lut[q]!;
    out[o + 1] = lut[q + 1]!;
    out[o + 2] = lut[q + 2]!;
    out[o + 3] = lut[q + 3]!;
  }
  return out;
}

/** True for indices of the player-colour ramp. */
export function isTeamIndex(meta: SheetMeta, i: number): boolean {
  return i >= meta.team[0] && i < meta.team[0] + meta.team[1];
}
