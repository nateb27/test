/**
 * Sprite renderer: ray-casts voxel models in the game's projection with sun and sky light, ambient occlusion and
 * soft shadows, supersamples, tone maps and reduces the result to the shared palette.
 *
 * World (0, 0, 0) lands on the sprite's anchor. Ground pixels are transparent except for the shadow the models cast
 * on them and their contact occlusion, stored as black with alpha (premultiplied, the same either way). Model pixels
 * are fully opaque: a pixel is model when at least half its subsamples hit a model, so edges never carry a fringe.
 *
 * `renderSprite` is a generator that yields every few rows, so the main-thread fallback can time-slice it.
 */

import { isTeam, material, out } from './materials';
import { ART_CONSTANTS, LIGHT, toDisplay } from './light';
import { hash3 } from './noise';
import { HALF_H, HALF_W, K, ZS } from './project';
import { castPrimary, hit, occluded } from './raycast';
import { TEAM_LEVELS, TEAM_LUM_DIVISOR, ditherMasked, sharedQuantizer, teamRamp } from './quantize';
import { blur2, samp, type Model } from './voxel';

/** Player colour the team pixels are written in before the manifest re-tints them. */
export const REFERENCE_TEAM: number = ART_CONSTANTS.team.referenceColor;

export interface SpriteFrame {
  /** Frame size in output pixels, and the anchor inside it. */
  w: number;
  h: number;
  ax: number;
  ay: number;
}

export interface SpriteSpec {
  models: Model[];
  /** Supersampling per axis. */
  ss: number;
  /** Cast shadow and contact occlusion on the ground (default true). */
  shadow?: boolean;
  /** Small figures: sharpen and add a subtle dark outline after downsampling. */
  unitPost?: boolean;
  /** Fixed frame; otherwise the frame is fitted to the models and their shadow. */
  frame?: SpriteFrame;
  /** Output pixels per world pixel (icons render larger). Default 1. */
  scale?: number;
  /** Skip palette reduction and also return the display colours (palette fitting). */
  raw?: boolean;
  /** Ground occlusion strength (0..1, default 1). */
  contact?: number;
}

export interface SpriteOut {
  w: number;
  h: number;
  ax: number;
  ay: number;
  /** Non-empty part of the frame. */
  tx: number;
  ty: number;
  tw: number;
  th: number;
  /** tw*th RGBA, not premultiplied (shadow pixels are black). */
  rgba: Uint8ClampedArray;
  /** Team pixels in the trim rect: (index << 4) | level. */
  team: Uint32Array;
  /** First frame row holding model pixels (not shadow), or -1. */
  top: number;
  /** With `raw`: display RGB (tw*th*3) and opacity of non-team model pixels. */
  rawRgb?: Float32Array;
  rawMask?: Uint8Array;
}

const lum3 = (c: readonly [number, number, number]): number => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];

/** Screen bounds (output px relative to the anchor) of models and their ground shadows. */
function fitFrame(models: readonly Model[], shadow: boolean, scale: number): SpriteFrame {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  const add = (x: number, y: number, z: number): void => {
    const sx = (x - y) * HALF_W * scale;
    const sy = ((x + y) * HALF_H - z * ZS) * scale;
    if (sx < x0) x0 = sx;
    if (sx > x1) x1 = sx;
    if (sy < y0) y0 = sy;
    if (sy > y1) y1 = sy;
  };
  for (const m of models) {
    // Fit to the solid content, not the (padded) grid.
    const b = contentBox(m);
    if (b === null) continue;
    for (const x of [b.x0, b.x1]) {
      for (const y of [b.y0, b.y1]) {
        add(x, y, 0);
        add(x, y, b.z1);
        if (shadow) add(x - (LIGHT.Lx / LIGHT.Lz) * b.z1, y - (LIGHT.Ly / LIGHT.Lz) * b.z1, 0);
      }
    }
  }
  if (x0 > x1) return { w: 1, h: 1, ax: 0, ay: 0 };
  const pad = 3;
  const ax = Math.ceil(-x0) + pad;
  const ay = Math.ceil(-y0) + pad;
  return { w: ax + Math.ceil(x1) + pad, h: ay + Math.ceil(y1) + pad, ax, ay };
}

/** Frame (output px) holding a world box and its ground shadow; used to give every look of a sprite id one frame. */
export function frameForBox(bx0: number, by0: number, bx1: number, by1: number, z1: number, shadow = true, scale = 1): SpriteFrame {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  const add = (x: number, y: number, z: number): void => {
    const sx = (x - y) * HALF_W * scale;
    const sy = ((x + y) * HALF_H - z * ZS) * scale;
    if (sx < x0) x0 = sx;
    if (sx > x1) x1 = sx;
    if (sy < y0) y0 = sy;
    if (sy > y1) y1 = sy;
  };
  for (const x of [bx0, bx1]) {
    for (const y of [by0, by1]) {
      add(x, y, 0);
      add(x, y, z1);
      if (shadow) add(x - (LIGHT.Lx / LIGHT.Lz) * z1, y - (LIGHT.Ly / LIGHT.Lz) * z1, 0);
    }
  }
  const pad = 3;
  const ax = Math.ceil(-x0) + pad;
  const ay = Math.ceil(-y0) + pad;
  return { w: ax + Math.ceil(x1) + pad, h: ay + Math.ceil(y1) + pad, ax, ay };
}

/** World box of a model's visible voxels (plus a margin for the AO reach), from its column tops. */
function contentBox(m: Model): { x0: number; y0: number; x1: number; y1: number; z1: number } | null {
  const top = m.top!;
  let i0 = m.nx;
  let i1 = -1;
  let j0 = m.ny;
  let j1 = -1;
  let zt = 0;
  for (let j = 0; j < m.ny; j++) {
    for (let i = 0; i < m.nx; i++) {
      const h = top[i + m.nx * j]!;
      if (h <= 0) continue;
      if (i < i0) i0 = i;
      if (i > i1) i1 = i;
      if (j < j0) j0 = j;
      if (j > j1) j1 = j;
      if (h > zt) zt = h;
    }
  }
  if (i1 < 0) return null;
  const mg = 0.25;
  return { x0: m.ox + i0 / m.res - mg, x1: m.ox + (i1 + 1) / m.res + mg, y0: m.oy + j0 / m.res - mg, y1: m.oy + (j1 + 1) / m.res + mg, z1: zt + 0.05 };
}

interface GroundAO {
  x0: number;
  y0: number;
  R: number;
  w: number;
  h: number;
  gao: Float32Array;
}

function groundAO(models: readonly Model[]): GroundAO | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const m of models) {
    x0 = Math.min(x0, m.ox);
    y0 = Math.min(y0, m.oy);
    x1 = Math.max(x1, m.x1);
    y1 = Math.max(y1, m.y1);
  }
  if (!(x1 > x0)) return null;
  x0 -= 1;
  y0 -= 1;
  x1 += 1;
  y1 += 1;
  const R = 8;
  const w = Math.ceil((x1 - x0) * R);
  const h = Math.ceil((y1 - y0) * R);
  const occ = new Float32Array(w * h);
  for (const m of models) {
    const top = m.top!;
    for (let j = 0; j < m.ny; j++) {
      for (let i = 0; i < m.nx; i++) {
        const hgt = top[i + m.nx * j]!;
        if (hgt <= 0) continue;
        const gi = Math.floor((m.ox + (i + 0.5) / m.res - x0) * R);
        const gj = Math.floor((m.oy + (j + 0.5) / m.res - y0) * R);
        if (gi < 0 || gj < 0 || gi >= w || gj >= h) continue;
        const v = Math.min(1, hgt / 0.5);
        const id = gi + w * gj;
        if (v > occ[id]!) occ[id] = v;
      }
    }
  }
  const t = new Float32Array(w * h);
  const o1 = occ.slice();
  blur2(o1, t, w, h, 1);
  blur2(o1, t, w, h, 1);
  const o2 = occ.slice();
  blur2(o2, t, w, h, 4);
  blur2(o2, t, w, h, 4);
  const gao = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) gao[i] = Math.max(0.2, Math.min(1, 1 - 0.5 * o1[i]! - 0.55 * o2[i]!));
  return { x0, y0, R, w, h, gao };
}

function sampleAO(a: GroundAO, x: number, y: number): number {
  let fx = (x - a.x0) * a.R - 0.5;
  let fy = (y - a.y0) * a.R - 0.5;
  const i = Math.floor(fx);
  const j = Math.floor(fy);
  fx -= i;
  fy -= j;
  const cl = (v: number, n: number): number => (v < 0 ? 0 : v >= n ? n - 1 : v);
  const i0 = cl(i, a.w);
  const i1 = cl(i + 1, a.w);
  const j0 = cl(j, a.h);
  const j1 = cl(j + 1, a.h);
  const g = a.gao;
  const p = g[i0 + a.w * j0]!;
  const q = g[i1 + a.w * j0]!;
  const r = g[i0 + a.w * j1]!;
  const s = g[i1 + a.w * j1]!;
  return p + (q - p) * fx + (r - p) * fy + (p - q - r + s) * fx * fy;
}

const ROWS_PER_YIELD = 24;

export function* renderSprite(spec: SpriteSpec): Generator<void, SpriteOut, void> {
  const models = spec.models;
  const ss = spec.ss;
  const scale = spec.scale ?? 1;
  const shadow = spec.shadow !== false;
  const contact = spec.contact ?? 1;
  for (const m of models) {
    if (m.dS === null) {
      m.finalize();
      yield;
    }
  }
  const frame = spec.frame ?? fitFrame(models, shadow, scale);
  const W = frame.w * ss;
  const H = frame.h * ss;
  const N = W * H;
  const L = LIGHT;
  const Lx = L.Lx;
  const Ly = L.Ly;
  const Lz = L.Lz;
  const NM = models.length;

  // Screen extents of each model (output px, relative to the anchor) for quick rejection.
  const boxes = models.map((m) => ({
    x0: m.ox + m.bx0 / m.res,
    y0: m.oy + m.by0 / m.res,
    x1: m.ox + (m.bx1 + 1) / m.res,
    y1: m.oy + (m.by1 + 1) / m.res,
    z1: m.oz + (m.bz1 + 1) / m.res,
  }));
  const mb = boxes.map((b) => ({
    sx0: (b.x0 - b.y1) * HALF_W * scale,
    sx1: (b.x1 - b.y0) * HALF_W * scale,
    sy0: ((b.x0 + b.y0) * HALF_H - b.z1 * ZS) * scale,
    sy1: (b.x1 + b.y1) * HALF_H * scale,
  }));

  // G-buffer.
  const mid = new Int8Array(N).fill(-1);
  const tb = new Float32Array(N);
  const gnx = new Float32Array(N);
  const gny = new Float32Array(N);
  const gnz = new Float32Array(N);
  const gmat = new Uint8Array(N);
  const gao = new Float32Array(N);
  const act: number[] = [];
  for (let py = 0; py < H; py++) {
    const sy = (py + 0.5) / ss - frame.ay;
    act.length = 0;
    for (let q = 0; q < NM; q++) if (sy >= mb[q]!.sy0 && sy <= mb[q]!.sy1) act.push(q);
    for (let px = 0; px < W; px++) {
      const i = px + W * py;
      if (act.length === 0) continue;
      const sx = (px + 0.5) / ss - frame.ax;
      const a = (sx / scale) / HALF_W;
      const b = (sy / scale) / HALF_H;
      const wx0 = (a + b) / 2;
      const wy0 = (b - a) / 2;
      let best = 0;
      let bm = -1;
      let ba = 0;
      let bmat = 0;
      for (let k = 0; k < act.length; k++) {
        const q = act[k]!;
        if (sx < mb[q]!.sx0 || sx > mb[q]!.sx1) continue;
        if (castPrimary(models[q]!, wx0, wy0, best)) {
          best = hit.t;
          bm = q;
          ba = hit.axis;
          bmat = hit.mat;
        }
      }
      tb[i] = best;
      if (bm < 0) continue;
      const m = models[bm]!;
      const R = m.res;
      mid[i] = bm;
      gmat[i] = bmat;
      const vx = (wx0 + best - m.ox) * R;
      const vy = (wy0 + best - m.oy) * R;
      const vz = (K * best - m.oz) * R;
      const d = m.dS!;
      const gx = samp(m, d, vx + 1, vy, vz) - samp(m, d, vx - 1, vy, vz);
      const gy = samp(m, d, vx, vy + 1, vz) - samp(m, d, vx, vy - 1, vz);
      const gz = samp(m, d, vx, vy, vz + 1) - samp(m, d, vx, vy, vz - 1);
      let l = Math.sqrt(gx * gx + gy * gy + gz * gz) + 1e-6;
      const fw = m.faceW;
      let nx = -gx / l + (ba === 0 ? fw : 0);
      let ny = -gy / l + (ba === 1 ? fw : 0);
      let nz = -gz / l + (ba === 2 ? fw : 0);
      l = Math.sqrt(nx * nx + ny * ny + nz * nz) + 1e-6;
      nx /= l;
      ny /= l;
      nz /= l;
      gnx[i] = nx;
      gny[i] = ny;
      gnz[i] = nz;
      const rr = m.rl * 1.1;
      const oc = samp(m, m.dL!, vx + nx * rr, vy + ny * rr, vz + nz * rr);
      const oc2 = samp(m, d, vx + nx * 1.6, vy + ny * 1.6, vz + nz * 1.6);
      gao[i] = Math.max(0.08, Math.min(1, (1.18 - 1.9 * oc) * (1.12 - 0.9 * oc2)));
    }
    if (py % ROWS_PER_YIELD === 0) yield;
  }

  // Shadows: one jittered ray per subsample towards the sun, then a depth-aware blur.
  const sh = new Float32Array(N).fill(1);
  let t1x = -Ly;
  let t1y = Lx;
  const tl = Math.hypot(t1x, t1y) || 1;
  t1x /= tl;
  t1y /= tl;
  const t2x = -Lz * t1y;
  const t2y = Lz * t1x;
  const t2z = Lx * t1y - Ly * t1x;
  const soft = L.soft;
  const ext = boxes;
  for (let py = 0; py < H; py++) {
    const sy = (py + 0.5) / ss - frame.ay;
    for (let px = 0; px < W; px++) {
      const i = px + W * py;
      const q = mid[i]!;
      if (q < 0 && !shadow) continue;
      const sx = (px + 0.5) / ss - frame.ax;
      const a = (sx / scale) / HALF_W;
      const b = (sy / scale) / HALF_H;
      const t = tb[i]!;
      let wx = (a + b) / 2 + t;
      let wy = (b - a) / 2 + t;
      let wz = K * t;
      if (q >= 0) {
        const nx = gnx[i]!;
        const ny = gny[i]!;
        const nz = gnz[i]!;
        if (nx * Lx + ny * Ly + nz * Lz <= -0.05) {
          sh[i] = 0;
          continue;
        }
        const e = 1.7 / models[q]!.res;
        wx += nx * e;
        wy += ny * e;
        wz += nz * e;
      } else wz += 0.004;
      const j1 = (hash3(px, py, 1) - 0.5) * 2 * soft;
      const j2 = (hash3(px, py, 2) - 0.5) * 2 * soft;
      const dx = Lx + t1x * j1 + t2x * j2;
      const dy = Ly + t1y * j1 + t2y * j2;
      const dz = Lz + t2z * j2;
      let blocked = false;
      for (let k = 0; k < NM && !blocked; k++) {
        const e = ext[k]!;
        const sT = (e.z1 - wz) / dz;
        if (sT <= 0) continue;
        const ex = wx + dx * sT;
        const ey = wy + dy * sT;
        if (Math.max(wx, ex) < e.x0 || Math.min(wx, ex) > e.x1 || Math.max(wy, ey) < e.y0 || Math.min(wy, ey) > e.y1) continue;
        if (occluded(models[k]!, wx, wy, wz, dx, dy, dz)) blocked = true;
      }
      sh[i] = blocked ? 0 : 1;
    }
    if (py % ROWS_PER_YIELD === 0) yield;
  }
  // Depth-aware blur, separable (horizontal then vertical): only same-model samples at a similar depth mix.
  const shb = new Float32Array(N);
  {
    const R = Math.max(1, Math.round(1.5 * ss));
    const tmpS = new Float32Array(N);
    for (let pass = 0; pass < 2; pass++) {
      const src = pass === 0 ? sh : tmpS;
      const dst = pass === 0 ? tmpS : shb;
      for (let py = 0; py < H; py++) {
        for (let px = 0; px < W; px++) {
          const i = px + W * py;
          const q = mid[i]!;
          const t = tb[i]!;
          let s = 0;
          let w = 0;
          for (let d = -R; d <= R; d++) {
            const xx = pass === 0 ? px + d : px;
            const yy = pass === 0 ? py : py + d;
            if (xx < 0 || xx >= W || yy < 0 || yy >= H) continue;
            const j = xx + W * yy;
            if (mid[j] !== q || Math.abs(tb[j]! - t) > 0.08) continue;
            s += src[j]!;
            w++;
          }
          dst[i] = w > 0 ? s / w : src[i]!;
        }
      }
    }
  }
  yield;

  // Shade.
  const ao = shadow ? groundAO(models) : null;
  const lin = new Float32Array(N * 3);
  const shA = new Float32Array(N);
  const sc = L.sunCol;
  const sk = L.skyCol;
  const bo = L.bounceCol;
  const vl = Math.sqrt(2 + K * K);
  let hx = Lx + 1 / vl;
  let hy = Ly + 1 / vl;
  let hz = Lz + K / vl;
  const hl = Math.hypot(hx, hy, hz);
  hx /= hl;
  hy /= hl;
  hz /= hl;
  const sunLum = lum3(sc) * Lz;
  const skyLum = lum3(sk);
  const grit = L.grit;
  for (let py = 0; py < H; py++) {
    const sy = (py + 0.5) / ss - frame.ay;
    for (let px = 0; px < W; px++) {
      const i = px + W * py;
      const q = mid[i]!;
      const sx = (px + 0.5) / ss - frame.ax;
      const a = (sx / scale) / HALF_W;
      const b = (sy / scale) / HALF_H;
      if (q < 0) {
        if (!shadow) continue;
        const gx = (a + b) / 2;
        const gy = (b - a) / 2;
        const g = ao !== null ? 1 - (1 - sampleAO(ao, gx, gy)) * contact : 1;
        const lit = sunLum * shb[i]! + skyLum * g;
        shA[i] = Math.max(0, 1 - lit / (sunLum + skyLum));
        continue;
      }
      const t = tb[i]!;
      const wx = (a + b) / 2 + t;
      const wy = (b - a) / 2 + t;
      const wz = K * t;
      const m = models[q]!;
      const nx = gnx[i]!;
      const ny = gny[i]!;
      const nz = gnz[i]!;
      const aoi = gao[i]!;
      material(gmat[i]!, wx - m.ox, wy - m.oy, wz, nx, ny, nz, m);
      const cav = 0.62 + 0.38 * Math.sqrt(aoi);
      const k = 1 - (1 - cav) * (out.wc ? 0.6 + 0.6 * grit : 0.45);
      const ar = out.r * k * out.r * k;
      const ag = out.g * k * out.g * k;
      const ab = out.b * k * out.b * k;
      const ndl = Math.max(0, nx * Lx + ny * Ly + nz * Lz) * shb[i]! * out.shm;
      const skyk = (0.6 + 0.4 * nz) * aoi;
      const bk = (0.5 - 0.5 * nz) * aoi;
      let r = ar * (sc[0] * ndl + sk[0] * skyk + bo[0] * bk);
      let g = ag * (sc[1] * ndl + sk[1] * skyk + bo[1] * bk);
      let bl = ab * (sc[2] * ndl + sk[2] * skyk + bo[2] * bk);
      if (gmat[i] === 63) {
        // Fire glows regardless of light.
        r = out.r;
        g = out.g;
        bl = out.b;
      }
      if (out.spec > 0 && ndl > 0) {
        const nh = Math.max(0, nx * hx + ny * hy + nz * hz);
        const s = out.spec * Math.pow(nh, 24) * shb[i]! * 1.5;
        r += s * sc[0];
        g += s * sc[1] * 0.95;
        bl += s * sc[2] * 0.85;
      }
      lin[i * 3] = r;
      lin[i * 3 + 1] = g;
      lin[i * 3 + 2] = bl;
    }
    if (py % ROWS_PER_YIELD === 0) yield;
  }

  // Downsample.
  const w = frame.w;
  const h = frame.h;
  const n = w * h;
  const rgb = new Float32Array(n * 3);
  const alpha = new Float32Array(n);
  const opaque = new Uint8Array(n);
  const teamPx = new Uint8Array(n);
  const ss2 = ss * ss;
  const tmp = [0, 0, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let nM = 0;
      let nT = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      let sa = 0;
      let nG = 0;
      for (let j = 0; j < ss; j++) {
        for (let i = 0; i < ss; i++) {
          const k = x * ss + i + W * (y * ss + j);
          if (mid[k]! >= 0) {
            nM++;
            if (isTeam(gmat[k]!)) nT++;
            r += lin[k * 3]!;
            g += lin[k * 3 + 1]!;
            b += lin[k * 3 + 2]!;
          } else {
            nG++;
            sa += shA[k]!;
          }
        }
      }
      const o = x + w * y;
      if (nM * 2 >= ss2) {
        toDisplay(r / nM, g / nM, b / nM, tmp);
        rgb[o * 3] = tmp[0]!;
        rgb[o * 3 + 1] = tmp[1]!;
        rgb[o * 3 + 2] = tmp[2]!;
        alpha[o] = 1;
        opaque[o] = 1;
        if (nT * 2 >= nM) teamPx[o] = 1;
      } else if (nG > 0) {
        alpha[o] = Math.round((sa / nG) * 20) / 20;
      }
    }
  }
  yield;

  if (spec.unitPost === true) unitPost(rgb, alpha, opaque, w, h);

  // Palette.
  const team: number[] = [];
  const nonTeam = new Uint8Array(n);
  for (let i = 0; i < n; i++) nonTeam[i] = opaque[i]! && !teamPx[i] ? 1 : 0;
  let rawRgb: Float32Array | undefined;
  const q = sharedQuantizer();
  if (spec.raw === true) rawRgb = rgb.slice();
  else if (q !== null) ditherMasked(rgb, nonTeam, w, h, q);
  const ramp = teamRamp(REFERENCE_TEAM);
  const levels = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = x + w * y;
      if (!teamPx[i]) continue;
      const lf = (0.3 * rgb[i * 3]! + 0.59 * rgb[i * 3 + 1]! + 0.11 * rgb[i * 3 + 2]!) / TEAM_LUM_DIVISOR;
      const bayer = (((x & 1) ^ (y & 1)) * 2 + (y & 1)) / 4 - 0.375;
      const lv = Math.max(0, Math.min(TEAM_LEVELS - 1, Math.floor(Math.min(0.999, lf) * TEAM_LEVELS + bayer)));
      levels[i] = lv;
      rgb[i * 3] = ramp[lv * 3]!;
      rgb[i * 3 + 1] = ramp[lv * 3 + 1]!;
      rgb[i * 3 + 2] = ramp[lv * 3 + 2]!;
    }
  }

  // Trim.
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  let topRow = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = x + w * y;
      if (alpha[i]! <= 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (topRow < 0 && opaque[i]) topRow = y;
    }
  }
  if (x1 < 0) {
    x0 = 0;
    y0 = 0;
    x1 = 0;
    y1 = 0;
  }
  const tw = x1 - x0 + 1;
  const th = y1 - y0 + 1;
  const rgba = new Uint8ClampedArray(tw * th * 4);
  const rawOut = rawRgb !== undefined ? new Float32Array(tw * th * 3) : undefined;
  const rawMask = rawRgb !== undefined ? new Uint8Array(tw * th) : undefined;
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const s = x + x0 + w * (y + y0);
      const d = x + tw * y;
      const a = alpha[s]!;
      if (a <= 0) continue;
      if (opaque[s]) {
        rgba[d * 4] = rgb[s * 3]!;
        rgba[d * 4 + 1] = rgb[s * 3 + 1]!;
        rgba[d * 4 + 2] = rgb[s * 3 + 2]!;
        if (teamPx[s]) team.push((d << 4) | levels[s]!);
      }
      rgba[d * 4 + 3] = Math.round(a * 255);
      if (rawOut !== undefined && rawMask !== undefined && rawRgb !== undefined && nonTeam[s]) {
        rawOut[d * 3] = rawRgb[s * 3]!;
        rawOut[d * 3 + 1] = rawRgb[s * 3 + 1]!;
        rawOut[d * 3 + 2] = rawRgb[s * 3 + 2]!;
        rawMask[d] = 1;
      }
    }
  }
  const result: SpriteOut = { w, h, ax: frame.ax, ay: frame.ay, tx: x0, ty: y0, tw, th, rgba, team: Uint32Array.from(team), top: topRow };
  if (rawOut !== undefined && rawMask !== undefined) {
    result.rawRgb = rawOut;
    result.rawMask = rawMask;
  }
  return result;
}

/** Run a renderer generator to completion (workers and tests). */
export function runToEnd<T>(g: Generator<void, T, void>): T {
  for (;;) {
    const r = g.next();
    if (r.done === true) return r.value;
  }
}

/**
 * Readability for small figures: unsharp mask on the model pixels, a darker inner silhouette edge and a soft dark
 * outline outside it (black with alpha, like the shadow, so it adds no colours).
 */
function unitPost(rgb: Float32Array, alpha: Float32Array, opaque: Uint8Array, w: number, h: number): void {
  const n = w * h;
  const src = rgb.slice();
  const isO = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && opaque[x + w * y] === 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = x + w * y;
      if (!opaque[i]) continue;
      let r = 0;
      let g = 0;
      let b = 0;
      let c = 0;
      let edge = false;
      for (const [dx, dy] of NB4) {
        const xx = x + dx;
        const yy = y + dy;
        if (!isO(xx, yy)) {
          edge = true;
          continue;
        }
        const j = xx + w * yy;
        r += src[j * 3]!;
        g += src[j * 3 + 1]!;
        b += src[j * 3 + 2]!;
        c++;
      }
      const k = 0.55;
      for (let ch = 0; ch < 3; ch++) {
        const v = src[i * 3 + ch]!;
        const avg = c > 0 ? [r, g, b][ch]! / c : v;
        let nv = v + k * (v - avg);
        if (edge) nv *= 0.8;
        rgb[i * 3 + ch] = Math.max(0, Math.min(255, nv));
      }
    }
  }
  const add = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = x + w * y;
      if (opaque[i]) continue;
      let touch = 0;
      for (const [dx, dy] of NB4) if (isO(x + dx, y + dy)) touch++;
      if (touch > 0) add[i] = 0.5;
    }
  }
  for (let i = 0; i < n; i++) if (add[i]! > alpha[i]!) alpha[i] = add[i]!;
}

const NB4: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
