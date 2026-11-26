/**
 * Voxel models: a dense material grid (one byte per cell) built from solid primitives, plus the blurred occupancy
 * fields the shader uses for smooth normals and ambient occlusion.
 *
 * Material 0 is air, 1 is the hidden ground fill under the model (solid for occlusion only), 2+ are visible
 * materials (see materials.ts). World coordinates are tiles; `res` cells per tile.
 */

import { clamp, vn2 } from './noise';

/** Ground-fill layers under each model. */
export const PAD = 3;

export type MatFn = (x: number, y: number, z: number) => number;
export type Mat = number | MatFn;
/** 0 add, 1 carve, 2 paint (only over existing visible material). */
export type OpMode = 0 | 1 | 2;

export interface RoofOpts {
  sag?: number;
  jit?: number;
  js?: number;
  fill?: Mat;
  fillInset?: number;
}

const matAt = (m: Mat, x: number, y: number, z: number): number => (typeof m === 'function' ? m(x, y, z) : m);

export class Model {
  readonly res: number;
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  /** World position of cell (0, 0, PAD)'s corner. */
  ox: number;
  oy: number;
  readonly oz: number;
  readonly mat: Uint8Array;
  /** Offset added to every op's coordinates (lets content be authored in footprint space with a margin around it). */
  lo = 0;
  /** Weight of the voxel face normal against the smooth field normal (0 = smooth, 1 = blocky). */
  faceW = 0.35;
  /** AO blur radius in cells (0 = derive from res). */
  aoR = 0;
  /** Centre of the first dome (lead ribs radiate from it). */
  domeC: [number, number] | null = null;
  seed: number;
  /** Set by finalize(). */
  dS: Uint8Array | null = null;
  dL: Uint8Array | null = null;
  /** Height (tiles) of the top solid voxel per column. */
  top: Float32Array | null = null;
  rl = 2;
  /** Cell box of the visible voxels (set by finalize; empty when bx1 < bx0): rays only march inside it. */
  bx0 = 0;
  bx1 = -1;
  by0 = 0;
  by1 = -1;
  bz1 = -1;

  constructor(x0: number, y0: number, w: number, d: number, h: number, res: number) {
    this.res = res;
    this.nx = Math.ceil(w * res);
    this.ny = Math.ceil(d * res);
    this.nz = Math.ceil(h * res) + PAD;
    this.ox = x0;
    this.oy = y0;
    this.oz = -PAD / res;
    this.mat = new Uint8Array(this.nx * this.ny * this.nz);
    this.mat.fill(1, 0, this.nx * this.ny * PAD);
    this.seed = (Math.floor(x0 * 131 + y0 * 977) & 0xffff) + 1;
  }

  /** World extent. */
  get x1(): number {
    return this.ox + this.nx / this.res;
  }
  get y1(): number {
    return this.oy + this.ny / this.res;
  }
  get z1(): number {
    return this.oz + this.nz / this.res;
  }

  /** Evaluate `fn` at every cell centre in the box and write the result by `mode`. */
  op(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, fn: Mat, mode: OpMode): void {
    const lo = this.lo;
    if (lo !== 0) {
      x0 += lo;
      x1 += lo;
      y0 += lo;
      y1 += lo;
      if (typeof fn === 'function') {
        const f = fn;
        fn = (x, y, z) => f(x - lo, y - lo, z);
      }
    }
    const R = this.res;
    const { nx, ny, nz, mat } = this;
    const i0 = Math.max(0, Math.floor(x0 * R));
    const i1 = Math.min(nx - 1, Math.ceil(x1 * R));
    const j0 = Math.max(0, Math.floor(y0 * R));
    const j1 = Math.min(ny - 1, Math.ceil(y1 * R));
    const k0 = Math.max(PAD, Math.floor(z0 * R) + PAD);
    const k1 = Math.min(nz - 1, Math.ceil(z1 * R) + PAD);
    const isF = typeof fn === 'function';
    const f = fn as MatFn;
    const c = fn as number;
    for (let k = k0; k <= k1; k++) {
      const lz = (k - PAD + 0.5) / R;
      for (let j = j0; j <= j1; j++) {
        const ly = (j + 0.5) / R;
        let id = nx * (j + ny * k) + i0;
        for (let i = i0; i <= i1; i++, id++) {
          const lx = (i + 0.5) / R;
          const v = isF ? f(lx, ly, lz) : c;
          if (!v) continue;
          if (mode === 1) mat[id] = 0;
          else if (mode === 2) {
            if (mat[id]! > 1) mat[id] = v;
          } else mat[id] = v;
        }
      }
    }
  }

  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, m: Mat): void {
    this.op(x0, y0, z0, x1, y1, z1, (x, y, z) => (x >= x0 && x < x1 && y >= y0 && y < y1 && z >= z0 && z < z1 ? matAt(m, x, y, z) : 0), 0);
  }

  carveBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    this.op(x0, y0, z0, x1, y1, z1, (x, y, z) => (x >= x0 && x < x1 && y >= y0 && y < y1 && z >= z0 && z < z1 ? 1 : 0), 1);
  }

  paintBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, m: Mat): void {
    this.op(x0, y0, z0, x1, y1, z1, (x, y, z) => (x >= x0 && x < x1 && y >= y0 && y < y1 && z >= z0 && z < z1 ? matAt(m, x, y, z) : 0), 2);
  }

  cyl(cx: number, cy: number, r: number, z0: number, z1: number, m: Mat): void {
    const r2 = r * r;
    this.op(cx - r, cy - r, z0, cx + r, cy + r, z1, (x, y, z) => {
      const dx = x - cx;
      const dy = y - cy;
      return dx * dx + dy * dy < r2 && z >= z0 && z < z1 ? matAt(m, x, y, z) : 0;
    }, 0);
  }

  sphere(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, m: Mat, mode: OpMode = 0): void {
    this.op(cx - rx, cy - ry, cz - rz, cx + rx, cy + ry, cz + rz, (x, y, z) => {
      const a = (x - cx) / rx;
      const b = (y - cy) / ry;
      const c = (z - cz) / rz;
      return a * a + b * b + c * c < 1 ? matAt(m, x, y, z) : 0;
    }, mode);
  }

  /** Cone-capped cylinder between two points, radius ra at a to rb at b. */
  capsule(ax: number, ay: number, az: number, bx: number, by: number, bz: number, ra: number, rb: number, m: Mat, mode: OpMode = 0): void {
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const L2 = ux * ux + uy * uy + uz * uz || 1e-9;
    const r = Math.max(ra, rb);
    this.op(Math.min(ax, bx) - r, Math.min(ay, by) - r, Math.min(az, bz) - r, Math.max(ax, bx) + r, Math.max(ay, by) + r, Math.max(az, bz) + r, (x, y, z) => {
      let t = ((x - ax) * ux + (y - ay) * uy + (z - az) * uz) / L2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = x - ax - ux * t;
      const dy = y - ay - uy * t;
      const dz = z - az - uz * t;
      const rr = ra + (rb - ra) * t;
      return dx * dx + dy * dy + dz * dz < rr * rr ? matAt(m, x, y, z) : 0;
    }, mode);
  }

  /** Flat disc (a shield): centre, unit normal, radius, half thickness; `rim` paints the edge `rimM`. */
  disc(cx: number, cy: number, cz: number, nx: number, ny: number, nz: number, r: number, th: number, m: number, rimM = 0, bossM = 0): void {
    const e = r + th;
    this.op(cx - e, cy - e, cz - e, cx + e, cy + e, cz + e, (x, y, z) => {
      const ex = x - cx;
      const ey = y - cy;
      const ez = z - cz;
      const dn = ex * nx + ey * ny + ez * nz;
      if (Math.abs(dn) >= th) return 0;
      const r2 = ex * ex + ey * ey + ez * ez - dn * dn;
      if (r2 >= r * r) return 0;
      if (bossM && r2 < r * r * 0.06) return bossM;
      if (rimM && r2 > (r - 0.012) * (r - 0.012)) return rimM;
      return m;
    }, 0);
  }

  /** Gable roof slab with the ridge along `axis`; returns the roof surface height function. */
  gable(x0: number, y0: number, x1: number, y1: number, zb: number, h: number, axis: 'x' | 'y', thick: number, m: Mat, o: RoofOpts = {}): (x: number, y: number) => number {
    const sag = o.sag ?? 0;
    const jit = o.jit ?? 0;
    const js = o.js ?? 9;
    const xc = (x0 + x1) / 2;
    const yc = (y0 + y1) / 2;
    const hx = (x1 - x0) / 2;
    const hy = (y1 - y0) / 2;
    const surf = (x: number, y: number): number => {
      const along = axis === 'x' ? (x - xc) / hx : (y - yc) / hy;
      const d = axis === 'x' ? Math.abs(y - yc) / hy : Math.abs(x - xc) / hx;
      return zb + h * (1 - d) - sag * (1 - along * along) * (1 - d * 0.6) + (jit ? (vn2(x * js, y * js) - 0.5) * jit : 0);
    };
    this.op(x0, y0, zb - thick - jit, x1, y1, zb + h + jit, (x, y, z) => {
      if (x < x0 || x >= x1 || y < y0 || y >= y1) return 0;
      const s = surf(x, y);
      return z <= s && z > s - thick ? matAt(m, x, y, z) : 0;
    }, 0);
    if (o.fill !== undefined) {
      const fi = o.fillInset ?? 0.08;
      const fm = o.fill;
      this.op(x0 + fi, y0 + fi, zb - 0.01, x1 - fi, y1 - fi, zb + h, (x, y, z) =>
        x >= x0 + fi && x < x1 - fi && y >= y0 + fi && y < y1 - fi && z <= surf(x, y) - thick * 0.5 ? matAt(fm, x, y, z) : 0, 0);
    }
    return surf;
  }

  /** Hip roof: height rises with the distance to the nearest edge, capped at h. */
  hip(x0: number, y0: number, x1: number, y1: number, zb: number, slope: number, h: number, thick: number, m: Mat, o: RoofOpts = {}): (x: number, y: number) => number {
    const jit = o.jit ?? 0;
    const js = o.js ?? 9;
    const sag = o.sag ?? 0;
    const xc = (x0 + x1) / 2;
    const yc = (y0 + y1) / 2;
    const hx = (x1 - x0) / 2;
    const hy = (y1 - y0) / 2;
    const surf = (x: number, y: number): number => {
      const e = Math.min(hx - Math.abs(x - xc), hy - Math.abs(y - yc));
      const ax = (x - xc) / hx;
      const ay = (y - yc) / hy;
      return zb + Math.min(h, slope * e) - sag * (1 - ax * ax) * (1 - ay * ay) + (jit ? (vn2(x * js, y * js) - 0.5) * jit : 0);
    };
    this.op(x0, y0, zb - thick - jit, x1, y1, zb + h + jit, (x, y, z) => {
      if (x < x0 || x >= x1 || y < y0 || y >= y1) return 0;
      const s = surf(x, y);
      return z <= s && z > s - thick ? matAt(m, x, y, z) : 0;
    }, 0);
    if (o.fill !== undefined) {
      const fi = o.fillInset ?? 0.08;
      const fm = o.fill;
      this.op(x0 + fi, y0 + fi, zb - 0.01, x1 - fi, y1 - fi, zb + h, (x, y, z) =>
        x >= x0 + fi && x < x1 - fi && y >= y0 + fi && y < y1 - fi && z <= surf(x, y) - thick * 0.5 ? matAt(fm, x, y, z) : 0, 0);
    }
    return surf;
  }

  /** Conical roof shell. */
  cone(cx: number, cy: number, r: number, zb: number, h: number, thick: number, m: Mat, jit = 0): void {
    this.op(cx - r, cy - r, zb - thick, cx + r, cy + r, zb + h, (x, y, z) => {
      const d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
      if (d > r) return 0;
      const s = zb + h * (1 - d / r) + (jit ? (vn2(x * 11, y * 11) - 0.5) * jit : 0);
      return z <= s && z > s - thick - (d < r * 0.5 ? 1 : 0) ? matAt(m, x, y, z) : 0;
    }, 0);
  }

  /** Half-ellipsoid dome on a circular base. */
  dome(cx: number, cy: number, zb: number, r: number, hs: number, m: Mat): void {
    this.domeC ??= [cx + this.lo, cy + this.lo];
    this.op(cx - r, cy - r, zb, cx + r, cy + r, zb + r * hs, (x, y, z) => {
      const a = (x - cx) / r;
      const b = (y - cy) / r;
      const c = (z - zb) / (r * hs);
      return a * a + b * b + c * c < 1 && z >= zb ? matAt(m, x, y, z) : 0;
    }, 0);
  }

  /**
   * Round-headed opening through a wall whose outer face is at `wpos` on the axis `axis` ('x': the wall faces +x),
   * centred at `c` along the wall. mode 1 carves; otherwise fills with `m`.
   */
  arch(axis: 'x' | 'y', c: number, wpos: number, depth: number, w: number, zb: number, hRect: number, mode: OpMode, m: Mat = 1): void {
    const r = w / 2;
    const fn = (x: number, y: number, z: number): number => {
      const along = axis === 'x' ? y : x;
      const across = axis === 'x' ? x : y;
      if (across < wpos - depth || across > wpos) return 0;
      const da = along - c;
      if (Math.abs(da) > r) return 0;
      if (z < zb) return 0;
      if (z < zb + hRect) return 1;
      const dz = z - zb - hRect;
      return da * da + dz * dz < r * r ? 1 : 0;
    };
    const bx = axis === 'x' ? [wpos - depth, c - r] : [c - r, wpos - depth];
    const ex = axis === 'x' ? [wpos, c + r] : [c + r, wpos];
    if (mode === 1) this.op(bx[0]!, bx[1]!, zb, ex[0]!, ex[1]!, zb + hRect + r, fn, 1);
    else this.op(bx[0]!, bx[1]!, zb, ex[0]!, ex[1]!, zb + hRect + r, (x, y, z) => (fn(x, y, z) ? matAt(m, x, y, z) : 0), mode);
  }

  /** Voussoir ring painted around an arch head. */
  archRing(axis: 'x' | 'y', c: number, wpos: number, depth: number, w: number, zb: number, hRect: number, ring: number, m: number): void {
    const r = w / 2 + ring;
    const fn = (x: number, y: number, z: number): number => {
      const along = axis === 'x' ? y : x;
      const across = axis === 'x' ? x : y;
      if (across < wpos - depth || across > wpos + 0.02) return 0;
      const da = along - c;
      const dz = z - zb - hRect;
      if (dz < 0) return 0;
      const d2 = da * da + dz * dz;
      return d2 < r * r && d2 > (w / 2) * (w / 2) * 0.9 ? m : 0;
    };
    const bx = axis === 'x' ? [wpos - depth, c - r] : [c - r, wpos - depth];
    const ex = axis === 'x' ? [wpos + 0.02, c + r] : [c + r, wpos + 0.02];
    this.op(bx[0]!, bx[1]!, zb + hRect, ex[0]!, ex[1]!, zb + hRect + r, fn, 2);
  }

  /** Independent copy of the material grid (fields are recomputed by finalize). */
  clone(): Model {
    const m = Object.create(Model.prototype) as Model;
    Object.assign(m, this);
    (m as { mat: Uint8Array }).mat = this.mat.slice();
    m.dS = null;
    m.dL = null;
    m.top = null;
    return m;
  }

  /** True when any visible voxel exists. */
  hasContent(): boolean {
    const { mat } = this;
    for (let i = this.nx * this.ny * PAD; i < mat.length; i++) if (mat[i]! > 1) return true;
    return false;
  }

  /** Build the blurred occupancy fields (dS: tight, for normals; dL: wide, for AO) and the column tops. */
  finalize(): void {
    const { nx, ny, nz, mat } = this;
    const rl = this.aoR || clamp(Math.round(0.11 * this.res), 2, 6);
    this.rl = rl;
    let x0 = nx;
    let x1 = -1;
    let y0 = ny;
    let y1 = -1;
    let z1 = -1;
    for (let k = PAD; k < nz; k++) {
      for (let j = 0; j < ny; j++) {
        let id = nx * (j + ny * k);
        for (let i = 0; i < nx; i++, id++) {
          if (mat[id]! > 1) {
            if (i < x0) x0 = i;
            if (i > x1) x1 = i;
            if (j < y0) y0 = j;
            if (j > y1) y1 = j;
            if (k > z1) z1 = k;
          }
        }
      }
    }
    const dS = new Uint8Array(nx * ny * nz);
    const dL = new Uint8Array(nx * ny * nz);
    const top = new Float32Array(nx * ny);
    this.dS = dS;
    this.dL = dL;
    this.top = top;
    this.bx0 = x0;
    this.bx1 = x1;
    this.by0 = y0;
    this.by1 = y1;
    this.bz1 = z1;
    if (x1 < 0) return;
    const mg = 2 * rl + 3;
    x0 = Math.max(0, x0 - mg);
    y0 = Math.max(0, y0 - mg);
    x1 = Math.min(nx - 1, x1 + mg);
    y1 = Math.min(ny - 1, y1 + mg);
    z1 = Math.min(nz - 1, z1 + mg);
    const bx = x1 - x0 + 1;
    const by = y1 - y0 + 1;
    const bz = z1 + 1;
    const N = bx * by * bz;
    const f = new Float32Array(N);
    const tmp = new Float32Array(N);
    for (let k = 0; k < bz; k++) {
      for (let j = 0; j < by; j++) {
        for (let i = 0; i < bx; i++) f[i + bx * (j + by * k)] = mat[i + x0 + nx * (j + y0 + ny * k)]! > 0 ? 1 : 0;
      }
    }
    const a = f.slice();
    blur3(a, tmp, bx, by, bz, 1);
    blur3(a, tmp, bx, by, bz, 1);
    blur3(f, tmp, bx, by, bz, rl);
    blur3(f, tmp, bx, by, bz, rl);
    for (let k = 0; k < bz; k++) {
      for (let j = 0; j < by; j++) {
        for (let i = 0; i < bx; i++) {
          const s = i + bx * (j + by * k);
          const d = i + x0 + nx * (j + y0 + ny * k);
          dS[d] = a[s]! * 255 + 0.5;
          dL[d] = f[s]! * 255 + 0.5;
        }
      }
    }
    // Below-ground layers outside the box stay solid for sampling.
    for (let k = 0; k < PAD; k++) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          if (i < x0 || i > x1 || j < y0 || j > y1) {
            const d = i + nx * (j + ny * k);
            dS[d] = 255;
            dL[d] = 255;
          }
        }
      }
    }
    for (let j = y0; j <= y1; j++) {
      for (let i = x0; i <= x1; i++) {
        for (let k = z1; k >= PAD; k--) {
          if (mat[i + nx * (j + ny * k)]! > 1) {
            top[i + nx * j] = (k - PAD + 1) / this.res;
            break;
          }
        }
      }
    }
  }
}

/** Running box blur of one line of a 3D array (clamped ends). */
export function blurLine(s: Float32Array, d: Float32Array, off: number, st: number, n: number, r: number): void {
  const inv = 1 / (2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) sum += s[off + st * (i < 0 ? 0 : i >= n ? n - 1 : i)]!;
  for (let i = 0; i < n; i++) {
    d[off + st * i] = sum * inv;
    const a = i - r;
    const b = i + r + 1;
    sum += s[off + st * (b >= n ? n - 1 : b)]! - s[off + st * (a < 0 ? 0 : a)]!;
  }
}

export function blur3(a: Float32Array, t: Float32Array, nx: number, ny: number, nz: number, r: number): void {
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) blurLine(a, t, nx * (y + ny * z), 1, nx, r);
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) blurLine(t, a, x + nx * ny * z, nx, ny, r);
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) blurLine(a, t, x + nx * y, nx * ny, nz, r);
  a.set(t);
}

export function blur2(a: Float32Array, t: Float32Array, w: number, h: number, r: number): void {
  for (let y = 0; y < h; y++) blurLine(a, t, w * y, 1, w, r);
  for (let x = 0; x < w; x++) blurLine(t, a, x, w, h, r);
}

/** Trilinear sample of a byte field at fractional cell coordinates, in [0, 1]. */
export function samp(m: Model, vol: Uint8Array, x: number, y: number, z: number): number {
  x -= 0.5;
  y -= 0.5;
  z -= 0.5;
  const { nx, ny, nz } = m;
  const i = Math.floor(x);
  const j = Math.floor(y);
  const k = Math.floor(z);
  const fx = x - i;
  const fy = y - j;
  const fz = z - k;
  const i0 = i < 0 ? 0 : i >= nx ? nx - 1 : i;
  const i1 = i + 1 < 0 ? 0 : i + 1 >= nx ? nx - 1 : i + 1;
  const j0 = j < 0 ? 0 : j >= ny ? ny - 1 : j;
  const j1 = j + 1 < 0 ? 0 : j + 1 >= ny ? ny - 1 : j + 1;
  const k0 = k < 0 ? 0 : k >= nz ? nz - 1 : k;
  const k1 = k + 1 < 0 ? 0 : k + 1 >= nz ? nz - 1 : k + 1;
  const a = nx * ny;
  const c000 = vol[i0 + nx * j0 + a * k0]!;
  const c100 = vol[i1 + nx * j0 + a * k0]!;
  const c010 = vol[i0 + nx * j1 + a * k0]!;
  const c110 = vol[i1 + nx * j1 + a * k0]!;
  const c001 = vol[i0 + nx * j0 + a * k1]!;
  const c101 = vol[i1 + nx * j0 + a * k1]!;
  const c011 = vol[i0 + nx * j1 + a * k1]!;
  const c111 = vol[i1 + nx * j1 + a * k1]!;
  const l0 = c000 + (c100 - c000) * fx + (c010 - c000) * fy + (c000 - c100 - c010 + c110) * fx * fy;
  const l1 = c001 + (c101 - c001) * fx + (c011 - c001) * fy + (c001 - c101 - c011 + c111) * fx * fy;
  return (l0 + (l1 - l0) * fz) / 255;
}
