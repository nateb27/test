/** Shared building blocks for the voxel models: props, banners, roof ridges, fences, scaffolding. */

import { M } from '../materials';
import { fract, hash2 } from '../noise';
import { Model } from '../voxel';

/** Margin (tiles) around a building footprint inside its model grid, for props, eaves and AO reach. */
export const MARGIN = 0.4;

/** A building model whose footprint (side `fp` tiles) is centred on world (0, 0); author content in [0, fp]. */
export function buildingModel(fp: number, h: number, res = 24): Model {
  const m = new Model(-fp / 2 - MARGIN, -fp / 2 - MARGIN, fp + 2 * MARGIN, fp + 2 * MARGIN, h, res);
  m.lo = MARGIN;
  m.faceW = 0.12;
  return m;
}

/** Copy of a model's material grid (to derive construction stages from a finished building). */
export function cloneModel(src: Model): Model {
  return src.clone();
}

export function logX(m: Model, x0: number, x1: number, cy: number, cz: number, r: number): void {
  m.op(x0, cy - r, cz - r, x1, cy + r, cz + r, (x, y, z) => {
    const d = (y - cy) * (y - cy) + (z - cz) * (z - cz);
    if (d > r * r || x < x0 || x > x1) return 0;
    return x - x0 < 0.015 || x1 - x < 0.015 ? M.LOGEND : M.BARK;
  }, 0);
}

export function logY(m: Model, y0: number, y1: number, cx: number, cz: number, r: number): void {
  m.op(cx - r, y0, cz - r, cx + r, y1, cz + r, (x, y, z) => {
    const d = (x - cx) * (x - cx) + (z - cz) * (z - cz);
    if (d > r * r || y < y0 || y > y1) return 0;
    return y - y0 < 0.015 || y1 - y < 0.015 ? M.LOGEND : M.BARK;
  }, 0);
}

export function barrel(m: Model, cx: number, cy: number, r: number, h: number, z0 = 0): void {
  m.op(cx - r, cy - r, z0, cx + r, cy + r, z0 + h, (x, y, zz) => {
    const z = zz - z0;
    const t = z / h;
    const rr = r * (0.86 + 0.14 * Math.sin(t * Math.PI));
    const d = Math.hypot(x - cx, y - cy);
    if (d > rr || z > h || z < 0) return 0;
    const f = fract(t * 4.2);
    return f < 0.13 && t > 0.1 && t < 0.9 ? M.IRONDARK : z > h - 0.012 ? M.LOGEND : M.PLANK;
  }, 0);
}

export function crate(m: Model, x: number, y: number, s: number, h = s, z0 = 0): void {
  m.box(x, y, z0, x + s, y + s, z0 + h, (px, py, pz) =>
    Math.min(px - x, x + s - px, py - y, y + s - py) < 0.012 || pz > z0 + h - 0.012 ? M.TIMBV : M.PLANK);
}

export function sack(m: Model, x: number, y: number, z: number, mt: number = M.SACK): void {
  m.sphere(x, y, z + 0.045, 0.055, 0.05, 0.05, mt);
}

/** Banner on a pole: team cloth hanging from a crossbar, turned towards the camera. */
export function banner(m: Model, px: number, py: number, top: number, len: number, wid: number): void {
  m.cyl(px, py, 0.016, 0, top + 0.06, M.TOOLWOOD);
  m.sphere(px, py, top + 0.07, 0.024, 0.024, 0.024, M.GOLDTRIM);
  m.op(px - 0.3, py - 0.3, top - len - 0.05, px + 0.3, py + 0.3, top, (x, y, z) => {
    const dx = x - px;
    const dy = y - py;
    const t = (dx - dy) * 0.7071;
    const n = (dx + dy) * 0.7071;
    if (t < 0.01 || t > wid) return 0;
    const zz = top - z;
    if (zz < 0 || zz > len - Math.abs(t - wid * 0.5) * 0.5) return 0;
    const wave = Math.sin(t * 28 + zz * 6) * 0.012 + zz * 0.03;
    if (Math.abs(n - wave) > 0.012) return 0;
    return zz < 0.025 || (zz > len * 0.45 && zz < len * 0.52) ? M.GOLDTRIM : M.BLUE;
  }, 0);
  m.capsule(px, py, top, px + 0.7071 * wid, py - 0.7071 * wid, top, 0.009, 0.009, M.TOOLWOOD);
}

/** Cloth hung flat on a wall face (axis 'x': on the +x face at x = wpos; 'y': on the +y face). */
export function wallBanner(m: Model, axis: 'x' | 'y', c: number, wpos: number, z1: number, len: number, wid: number): void {
  const z0 = z1 - len;
  m.op(axis === 'x' ? wpos : c - wid / 2, axis === 'x' ? c - wid / 2 : wpos, z0 - 0.06, axis === 'x' ? wpos + 0.03 : c + wid / 2, axis === 'x' ? c + wid / 2 : wpos + 0.03, z1 + 0.02, (x, y, z) => {
    const along = axis === 'x' ? y - c : x - c;
    const across = axis === 'x' ? x - wpos : y - wpos;
    if (across < 0 || across > 0.025) return 0;
    if (Math.abs(along) > wid / 2) return 0;
    const tip = Math.abs(along) / (wid / 2);
    if (z < z0 - 0.06 * (1 - tip) || z > z1) return 0;
    if (z > z1 - 0.025 || Math.abs(along) > wid / 2 - 0.016) return M.GOLDTRIM;
    return M.BLUE;
  }, 0);
}

/** Rounded ridge cap following a roof surface. */
export function ridge(m: Model, surf: (x: number, y: number) => number, axis: 'x' | 'y', a0: number, a1: number, c: number, mt: number): void {
  const w = 0.045;
  const fn = (x: number, y: number, z: number): number => {
    const along = axis === 'x' ? x : y;
    const d = axis === 'x' ? y - c : x - c;
    if (along < a0 || along > a1 || Math.abs(d) > w) return 0;
    const top = axis === 'x' ? surf(x, c) : surf(c, y);
    const k = 1 - (d / w) * (d / w);
    return z > top - 0.03 && z < top + 0.032 * Math.sqrt(k) ? mt : 0;
  };
  if (axis === 'x') m.op(a0, c - w, 0, a1, c + w, 4, fn, 0);
  else m.op(c - w, a0, 0, c + w, a1, 4, fn, 0);
}

/** Post-and-rail fence between two points. */
export function fence(m: Model, x0: number, y0: number, x1: number, y1: number, h = 0.25, mt: number = M.OLDWOOD): void {
  const L = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(1, Math.round(L / 0.24));
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    const y = y0 + ((y1 - y0) * i) / n;
    m.cyl(x, y, 0.017, 0, h + 0.04 * hash2(i, Math.round(x * 10 + y * 7)), mt);
  }
  m.capsule(x0, y0, h * 0.8, x1, y1, h * 0.8, 0.012, 0.012, mt);
  m.capsule(x0, y0, h * 0.4, x1, y1, h * 0.4, 0.012, 0.012, mt);
}

/** Woven wattle fence (early farms and yards). */
export function wattle(m: Model, x0: number, y0: number, x1: number, y1: number, h = 0.2): void {
  const L = Math.hypot(x1 - x0, y1 - y0);
  const ux = (x1 - x0) / L;
  const uy = (y1 - y0) / L;
  const n = Math.max(1, Math.round(L / 0.2));
  for (let i = 0; i <= n; i++) m.cyl(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, 0.014, 0, h + 0.03, M.BARK);
  m.op(Math.min(x0, x1) - 0.03, Math.min(y0, y1) - 0.03, 0, Math.max(x0, x1) + 0.03, Math.max(y0, y1) + 0.03, h, (x, y, z) => {
    const t = (x - x0) * ux + (y - y0) * uy;
    if (t < 0 || t > L) return 0;
    const nrm = (x - x0) * -uy + (y - y0) * ux;
    const weave = Math.sin(t * 30 + Math.floor(z / 0.03) * Math.PI) * 0.012;
    return Math.abs(nrm - weave) < 0.012 ? M.OLDWOOD : 0;
  }, 0);
}

/** Pointed palisade stakes along a line. */
export function palisade(m: Model, x0: number, y0: number, x1: number, y1: number, h = 0.45): void {
  const L = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(1, Math.round(L / 0.095));
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    const y = y0 + ((y1 - y0) * i) / n;
    const hh = h + 0.08 * hash2(i, Math.round(x * 100 + y * 31));
    m.op(x - 0.05, y - 0.05, 0, x + 0.05, y + 0.05, hh + 0.08, (px, py, pz) => {
      const d = Math.hypot(px - x, py - y);
      const r = pz < hh ? 0.042 : 0.042 * (1 - (pz - hh) / 0.08);
      return d < r ? M.BARK : 0;
    }, 0);
  }
}

/** Stack of logs along x. */
export function logPileX(m: Model, x0: number, x1: number, y0: number, rows: number, r = 0.05): void {
  for (let rr = 0; rr < rows; rr++) for (let k = 0; k < rows + 1 - rr; k++) logX(m, x0 + rr * 0.02, x1 - rr * 0.02, y0 + k * r * 2.05 + rr * r, r + rr * r * 1.7, r);
}

/** Stack of logs along y. */
export function logPileY(m: Model, y0: number, y1: number, x0: number, rows: number, r = 0.05): void {
  for (let rr = 0; rr < rows; rr++) for (let k = 0; k < rows + 1 - rr; k++) logY(m, y0 + rr * 0.02, y1 - rr * 0.02, x0 + k * r * 2.05 + rr * r, r + rr * r * 1.7, r);
}

/** Squared stone blocks in a little stack. */
export function blockPile(m: Model, x: number, y: number, n: number, s = 0.11, mt: number = M.ASHLAR): void {
  let k = 0;
  for (let layer = 0; k < n; layer++) {
    const per = Math.max(1, 3 - layer);
    for (let i = 0; i < per && k < n; i++, k++) {
      const bx = x + i * (s * 1.05) + layer * s * 0.5;
      m.box(bx, y + (layer & 1) * 0.02, layer * s * 0.8, bx + s, y + s * 1.3, layer * s * 0.8 + s * 0.78, mt);
    }
  }
}

/** Timber scaffold around a rectangle: standards, ledgers, plank decks and braces up to `h`. */
export function scaffold(m: Model, x0: number, y0: number, x1: number, y1: number, h: number, decks: readonly number[]): void {
  const off = 0.08;
  const X0 = x0 - off;
  const Y0 = y0 - off;
  const X1 = x1 + off;
  const Y1 = y1 + off;
  const poles: [number, number][] = [];
  const nx = Math.max(1, Math.round((X1 - X0) / 0.5));
  const ny = Math.max(1, Math.round((Y1 - Y0) / 0.5));
  for (let i = 0; i <= nx; i++) {
    poles.push([X0 + ((X1 - X0) * i) / nx, Y1]);
    poles.push([X0 + ((X1 - X0) * i) / nx, Y0]);
  }
  for (let j = 1; j < ny; j++) {
    poles.push([X1, Y0 + ((Y1 - Y0) * j) / ny]);
    poles.push([X0, Y0 + ((Y1 - Y0) * j) / ny]);
  }
  for (const [px, py] of poles) m.cyl(px, py, 0.016, 0, h + 0.05 * hash2(Math.round(px * 50), Math.round(py * 50)), M.OLDWOOD);
  for (const z of decks) {
    m.capsule(X0, Y1, z, X1, Y1, z, 0.012, 0.012, M.OLDWOOD);
    m.capsule(X1, Y0, z, X1, Y1, z, 0.012, 0.012, M.OLDWOOD);
    m.capsule(X0, Y0, z, X1, Y0, z, 0.012, 0.012, M.OLDWOOD);
    m.capsule(X0, Y0, z, X0, Y1, z, 0.012, 0.012, M.OLDWOOD);
    m.box(X0, Y1 - 0.07, z, X1, Y1 + 0.03, z + 0.022, M.PLANK);
    m.box(X1 - 0.07, Y0, z, X1 + 0.03, Y1, z + 0.022, M.PLANK);
  }
  // Braces on the two visible faces.
  for (let i = 0; i < nx; i++) {
    const a = X0 + ((X1 - X0) * i) / nx;
    const b = X0 + ((X1 - X0) * (i + 1)) / nx;
    if (i % 2 === 0) m.capsule(a, Y1 + 0.02, 0.02, b, Y1 + 0.02, Math.min(h, decks[0] ?? h), 0.01, 0.01, M.OLDWOOD);
  }
  for (let j = 0; j < ny; j++) {
    const a = Y0 + ((Y1 - Y0) * j) / ny;
    const b = Y0 + ((Y1 - Y0) * (j + 1)) / ny;
    if (j % 2 === 1) m.capsule(X1 + 0.02, a, 0.02, X1 + 0.02, b, Math.min(h, decks[0] ?? h), 0.01, 0.01, M.OLDWOOD);
  }
}

/** A leaning ladder. */
export function ladder(m: Model, x: number, y: number, x2: number, y2: number, h: number): void {
  const ux = y2 - y;
  const uy = x - x2;
  const l = Math.hypot(ux, uy) || 1;
  const sx = (ux / l) * 0.05;
  const sy = (uy / l) * 0.05;
  m.capsule(x - sx, y - sy, 0, x2 - sx, y2 - sy, h, 0.01, 0.01, M.OLDWOOD);
  m.capsule(x + sx, y + sy, 0, x2 + sx, y2 + sy, h, 0.01, 0.01, M.OLDWOOD);
  for (let t = 0.1; t < 1; t += 0.14) {
    const cx = x + (x2 - x) * t;
    const cy = y + (y2 - y) * t;
    m.capsule(cx - sx, cy - sy, h * t, cx + sx, cy + sy, h * t, 0.007, 0.007, M.OLDWOOD);
  }
}

/** Stakes and a taut line marking out a footprint. */
export function markOut(m: Model, x0: number, y0: number, x1: number, y1: number): void {
  const pts: [number, number][] = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  for (const [x, y] of pts) m.capsule(x, y, 0, x, y, 0.16, 0.014, 0.008, M.OLDWOOD);
  for (let i = 0; i < 4; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % 4]!;
    m.capsule(a[0], a[1], 0.12, b[0], b[1], 0.12, 0.004, 0.004, M.ROPE);
  }
}

/** Dug earth band (foundation trench spoil) inside a rectangle edge. */
export function trench(m: Model, x0: number, y0: number, x1: number, y1: number, w = 0.12): void {
  m.op(x0 - 0.05, y0 - 0.05, 0, x1 + 0.05, y1 + 0.05, 0.05, (x, y, z) => {
    const e = Math.min(x - x0, x1 - x, y - y0, y1 - y);
    if (e < -0.05 || e > w + 0.05) return 0;
    const ridgeH = 0.035 * (1 - Math.abs(e - w * 0.5) / (w * 0.5 + 0.05)) + 0.008;
    return z < ridgeH ? M.EARTH : 0;
  }, 0);
}
