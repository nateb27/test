/**
 * Every building except the Town Center, in an early look (timber, wattle and daub, thatch or shingle, rough stone
 * footing; ages I-II) and a late look (dressed stone with brick banding, arches, tiled roofs; ages III-IV).
 * Footprint coordinates: [0, fp] on both axes; +x faces down-right, +y down-left, so the +x and +y walls face the
 * camera. Original designs with an Eastern Roman character.
 */

import { M } from '../materials';
import { fract, hash2 } from '../noise';
import type { Model } from '../voxel';
import {
  ladder as ladderLean,
  banner,
  barrel,
  blockPile,
  crate,
  fence,
  logPileX,
  logPileY,
  logX,
  palisade,
  ridge,
  sack,
  wallBanner,
  wattle,
} from './kit';

// ---------------------------------------------------------------------------
// Shared props
// ---------------------------------------------------------------------------

/** Windmill sails turned towards the camera, hub at (hx, hy, hz). */
function sails(m: Model, hx: number, hy: number, hz: number, R: number, cloth: number): void {
  const d = 0.7071;
  m.capsule(hx - 0.32 * d, hy - 0.32 * d, hz, hx + 0.04, hy + 0.04, hz, 0.035, 0.035, M.TIMBH);
  m.op(hx - R, hy - R, hz - R, hx + R, hy + R, hz + R, (x, y, z) => {
    const rx = x - hx;
    const ry = y - hy;
    const rz = z - hz;
    const n = (rx + ry) * d;
    if (Math.abs(n) > 0.05) return 0;
    const e1 = (-rx + ry) * d;
    const e2 = rz;
    const r = Math.hypot(e1, e2);
    if (r > R) return 0;
    if (r < 0.05) return M.TIMBH;
    for (let k = 0; k < 4; k++) {
      const a = 0.45 + (k * Math.PI) / 2;
      const ax = Math.cos(a);
      const ay = Math.sin(a);
      const s = e1 * ax + e2 * ay;
      const w = -e1 * ay + e2 * ax;
      if (s < 0) continue;
      if (Math.abs(w) < 0.022 && Math.abs(n) < 0.03) return M.TIMBH;
      if (w > 0.02 && w < 0.17 && s > 0.14 && s < R && Math.abs(n - 0.015) < 0.022) {
        if (fract(s / 0.075) < 0.14 || Math.abs(w - 0.15) < 0.012) return M.TOOLWOOD;
        return cloth;
      }
    }
    return 0;
  }, 0);
}

/** Two-wheeled cart; `load` fills the bed. Bed along x. */
function cart(m: Model, x: number, y: number, load: number): void {
  m.box(x, y, 0.12, x + 0.34, y + 0.2, 0.15, M.PLANK);
  m.box(x, y, 0.15, x + 0.34, y + 0.02, 0.24, M.PLANK);
  m.box(x, y + 0.18, 0.15, x + 0.34, y + 0.2, 0.24, M.PLANK);
  m.box(x, y, 0.15, x + 0.02, y + 0.2, 0.24, M.PLANK);
  m.box(x + 0.32, y, 0.15, x + 0.34, y + 0.2, 0.24, M.PLANK);
  for (const wy of [y - 0.02, y + 0.22]) {
    m.op(x + 0.08, wy - 0.02, 0, x + 0.26, wy + 0.02, 0.2, (px, py, pz) => {
      const r = Math.hypot(px - (x + 0.17), pz - 0.1);
      if (Math.abs(py - wy) > 0.016) return 0;
      return r < 0.095 && (r > 0.075 || Math.abs(px - (x + 0.17)) < 0.012 || Math.abs(pz - 0.1) < 0.012) ? M.OLDWOOD : 0;
    }, 0);
  }
  m.capsule(x + 0.34, y + 0.06, 0.15, x + 0.62, y + 0.06, 0.03, 0.012, 0.012, M.TOOLWOOD);
  m.capsule(x + 0.34, y + 0.14, 0.15, x + 0.62, y + 0.14, 0.03, 0.012, 0.012, M.TOOLWOOD);
  if (load) {
    m.op(x + 0.02, y + 0.02, 0.15, x + 0.32, y + 0.18, 0.34, (px, py, pz) => {
      const cx = x + 0.17;
      const cy = y + 0.1;
      const hgt = 0.27 + 0.06 * (1 - ((px - cx) / 0.15) ** 2) * (1 - ((py - cy) / 0.08) ** 2) + 0.02 * (hash2(Math.floor(px * 60), Math.floor(py * 60)) - 0.5);
      return pz < hgt ? load : 0;
    }, 0);
  }
}

/** Pick or shovel leaning against something. */
function tool(m: Model, x: number, y: number, x2: number, y2: number, h: number, head: 'pick' | 'shovel' | 'axe'): void {
  m.capsule(x, y, 0, x2, y2, h, 0.009, 0.009, M.TOOLWOOD);
  if (head === 'pick') m.capsule(x2 - 0.06, y2 + 0.04, h, x2 + 0.06, y2 - 0.04, h + 0.01, 0.012, 0.012, M.IRONDARK);
  else if (head === 'axe') m.box(x2 - 0.02, y2 - 0.02, h - 0.06, x2 + 0.03, y2 + 0.02, h, M.METAL);
  else m.box(x - 0.03, y - 0.03, 0, x + 0.03, y + 0.03, 0.07, M.METAL);
}

/** Round straw archery butt on a little stand, face turned to the camera, painted rings. */
function butt(m: Model, x: number, y: number, r: number): void {
  const nx = 0.7071;
  const ny = 0.7071;
  const cz = r + 0.1;
  m.capsule(x - 0.1, y + 0.1, 0, x - 0.04, y + 0.04, cz, 0.012, 0.012, M.OLDWOOD);
  m.capsule(x + 0.1, y - 0.1, 0, x + 0.04, y - 0.04, cz, 0.012, 0.012, M.OLDWOOD);
  m.capsule(x - 0.12, y - 0.12, 0, x - 0.03, y - 0.03, cz + 0.05, 0.012, 0.012, M.OLDWOOD);
  m.op(x - r - 0.1, y - r - 0.1, cz - r - 0.05, x + r + 0.1, y + r + 0.1, cz + r + 0.05, (px, py, pz) => {
    const ex = px - x;
    const ey = py - y;
    const ez = pz - cz;
    const dn = ex * nx + ey * ny;
    if (dn < -0.06 || dn > 0.03) return 0;
    const r2 = ex * ex + ey * ey + ez * ez - dn * dn;
    if (r2 > r * r) return 0;
    if (dn < -0.015) return M.TARGET;
    const f = Math.sqrt(r2) / r;
    return f < 0.2 ? M.DYE_YELLOW : f < 0.42 ? M.DYE_RED : f < 0.62 ? M.LINEN : f < 0.82 ? M.BLUEPAINT : M.TARGET;
  }, 0);
}

/** Simple standing horse (stable paddocks). Body along the direction th. */
function horse(m: Model, cx: number, cy: number, th: number, coat: number): void {
  const c = Math.cos(th);
  const s = Math.sin(th);
  const P = (a: number, b: number): [number, number] => [cx + a * c - b * s, cy + a * s + b * c];
  const C = (a0: number, b0: number, z0: number, a1: number, b1: number, z1: number, r0: number, r1: number, mt: number): void => {
    const p = P(a0, b0);
    const q = P(a1, b1);
    m.capsule(p[0], p[1], z0, q[0], q[1], z1, r0, r1, mt);
  };
  const k = 1.0;
  C(-0.2 * k, 0, 0.36, 0.17 * k, 0, 0.38, 0.1, 0.1, coat);
  C(0.17, 0, 0.4, 0.3, 0, 0.58, 0.07, 0.045, coat);
  C(0.3, 0, 0.59, 0.42, 0, 0.5, 0.042, 0.03, coat);
  C(0.24, 0, 0.48, 0.3, 0, 0.62, 0.03, 0.02, M.HORSEDK);
  C(-0.24, 0, 0.4, -0.31, 0, 0.2, 0.03, 0.02, M.HORSEDK);
  for (const [a, b] of [[0.15, 0.055], [0.15, -0.055], [-0.17, 0.055], [-0.17, -0.055]] as const) {
    C(a, b, 0.32, a, b, 0.14, 0.032, 0.024, coat);
    C(a, b, 0.14, a, b, 0.02, 0.022, 0.018, M.HORSEDK);
  }
}

/** Hanging cloth panel between two posts (silk drying racks): plane faces the camera. */
function clothPanel(m: Model, x: number, y: number, w: number, z1: number, len: number, mt: number): void {
  const d = 0.7071;
  m.op(x - w, y - w, z1 - len - 0.05, x + w, y + w, z1, (px, py, pz) => {
    const ex = px - x;
    const ey = py - y;
    const t = (ex - ey) * d;
    const n = (ex + ey) * d;
    if (Math.abs(t) > w / 2) return 0;
    const zz = z1 - pz;
    if (zz < 0 || zz > len) return 0;
    const wave = Math.sin(t * 22) * 0.01;
    return Math.abs(n - wave) < 0.012 ? mt : 0;
  }, 0);
}

// ---------------------------------------------------------------------------
// House
// ---------------------------------------------------------------------------

export function house1(m: Model): void {
  m.box(0.36, 0.46, 0, 1.64, 1.54, 0.15, M.RUBBLE);
  m.box(0.4, 0.5, 0.15, 1.6, 1.5, 0.56, M.DAUB);
  for (const [x, y] of [[0.4, 0.5], [1.55, 0.5], [0.4, 1.45], [1.55, 1.45], [1.0, 1.45]] as const) m.box(x - 0.01, y - 0.01, 0.12, x + 0.06, y + 0.06, 0.56, M.TIMBV);
  m.box(1.53, 0.97, 0.12, 1.6, 1.03, 0.56, M.TIMBV);
  m.box(0.4, 1.47, 0.15, 1.61, 1.52, 0.19, M.TIMBH);
  m.box(1.55, 0.5, 0.15, 1.62, 1.5, 0.19, M.TIMBH);
  m.op(0.4, 1.46, 0.19, 1.0, 1.52, 0.48, (x, _y, z) => (Math.abs((x - 0.4) / 0.6 - (z - 0.19) / 0.29) < 0.07 ? M.TIMBV : 0), 0);
  m.hip(0.25, 0.35, 1.75, 1.65, 0.53, 0.95, 0.52, 0.12, M.THATCH, { jit: 0.04, js: 8, sag: 0.05, fill: M.DAUB });
  m.box(1.18, 1.45, 0.15, 1.38, 1.5, 0.44, M.DOOR);
  m.carveBox(1.18, 1.48, 0.15, 1.38, 1.53, 0.44);
  m.box(1.14, 1.5, 0.44, 1.42, 1.54, 0.47, M.BLUEPAINT);
  m.carveBox(1.5, 0.7, 0.3, 1.63, 0.82, 0.4);
  m.box(1.6, 0.66, 0.29, 1.64, 0.86, 0.42, M.BLUEPAINT);
  m.capsule(0.75, 1.0, 1.04, 1.25, 1.0, 1.04, 0.035, 0.035, M.THATCH);
  for (let r = 0; r < 2; r++) for (let k = 0; k < 3 - r; k++) logX(m, 0.42, 0.9, 1.68 + k * 0.08 + r * 0.04, 0.04 + r * 0.07, 0.04);
  m.op(1.65, 1.55, 0, 1.85, 1.75, 0.12, (x, y, z) => {
    const d = Math.hypot(x - 1.75, y - 1.65);
    return d < 0.08 && (d > 0.065 || z < 0.02) ? M.STRAW : 0;
  }, 0);
  for (let t = 0; t < 7; t++) m.cyl(1.75 + t * 0.03, 0.3 - t * 0.012, 0.012, 0, 0.22, M.OLDWOOD);
}

export function house4(m: Model): void {
  m.box(0.22, 0.32, 0, 1.78, 1.68, 0.08, M.ASHLAR);
  m.box(0.25, 0.35, 0.08, 1.75, 1.65, 1.0, M.BYZ);
  m.box(0.22, 0.32, 0.5, 1.78, 1.68, 0.54, M.ASHLAR);
  m.box(0.22, 0.32, 0.96, 1.78, 1.68, 1.0, M.ASHLAR);
  m.hip(0.14, 0.24, 1.86, 1.76, 1.0, 0.55, 0.4, 0.07, M.TILE, { jit: 0.012, sag: 0.02 });
  for (const x of [0.6, 1.4]) {
    m.arch('y', x, 1.65, 0.12, 0.12, 0.62, 0.14, 1);
    m.archRing('y', x, 1.65, 0.12, 0.12, 0.62, 0.14, 0.03, M.BRICK);
  }
  for (const y of [0.65, 1.0, 1.35]) {
    m.arch('x', y, 1.75, 0.12, 0.12, 0.62, 0.14, 1);
    m.archRing('x', y, 1.75, 0.12, 0.12, 0.62, 0.14, 0.03, M.BRICK);
  }
  m.arch('y', 1.0, 1.65, 0.1, 0.22, 0.08, 0.26, 1);
  m.archRing('y', 1.0, 1.65, 0.1, 0.22, 0.08, 0.26, 0.045, M.BRICK);
  m.box(0.89, 1.54, 0.08, 1.11, 1.57, 0.5, M.DOOR);
  for (const y of [0.65, 1.35]) m.arch('x', y, 1.75, 0.1, 0.1, 0.22, 0.12, 1);
  m.box(1.75, 0.55, 0.52, 1.95, 1.45, 0.56, M.PLANK);
  for (const y of [0.57, 0.85, 1.15, 1.43]) m.box(1.9, y - 0.015, 0.56, 1.93, y + 0.015, 0.74, M.OLDWOOD);
  m.box(1.89, 0.55, 0.72, 1.94, 1.45, 0.75, M.OLDWOOD);
  // Team-colour cloth hung over the balcony rail.
  m.box(1.935, 0.75, 0.56, 1.955, 1.25, 0.75, M.BLUE);
  for (const y of [0.6, 1.4]) m.capsule(1.75, y, 0.4, 1.92, y, 0.54, 0.015, 0.015, M.TIMBV);
  m.op(1.75, 0.5, 0.86, 2.02, 1.5, 0.98, (x, _y, z) => {
    const s = 0.98 - (x - 1.75) * 0.4;
    return z < s && z > s - 0.03 ? M.TILE : 0;
  }, 0);
  m.box(0.4, 0.5, 1.0, 0.55, 0.62, 1.38, M.BRICK);
  barrel(m, 0.42, 1.78, 0.06, 0.14);
  crate(m, 1.45, 1.74, 0.12);
  sack(m, 0.6, 1.82, 0);
}

// ---------------------------------------------------------------------------
// Mill
// ---------------------------------------------------------------------------

export function millEarly(m: Model): void {
  m.cyl(1, 1, 0.5, 0, 0.2, M.RUBBLE);
  m.cyl(1, 1, 0.46, 0.2, 0.86, M.DAUB);
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    const x = 1 + Math.cos(a) * 0.46;
    const y = 1 + Math.sin(a) * 0.46;
    m.cyl(x, y, 0.03, 0.2, 0.86, M.TIMBV);
  }
  m.op(0.4, 0.4, 0.5, 1.6, 1.6, 0.56, () => M.TIMBH, 2);
  m.op(0.4, 0.4, 0.8, 1.6, 1.6, 0.86, () => M.TIMBH, 2);
  m.cone(1, 1, 0.62, 0.84, 0.62, 0.12, M.THATCH, 0.03);
  m.op(0.3, 0.3, 0, 1.7, 1.7, 0.55, (x, y, z) => {
    const a = Math.atan2(y - 1, x - 1);
    return Math.abs(a - 0.785) < 0.18 && z > 0.02 && z < 0.48 && Math.hypot(x - 1, y - 1) > 0.36 ? 1 : 0;
  }, 1);
  m.op(0.3, 0.3, 0, 1.7, 1.7, 0.55, (x, y, z) => {
    const a = Math.atan2(y - 1, x - 1);
    const r = Math.hypot(x - 1, y - 1);
    return Math.abs(a - 0.785) < 0.18 && z < 0.48 && r > 0.36 && r < 0.4 ? M.DOOR : 0;
  }, 0);
  sails(m, 1 + 0.5 * 0.7071, 1 + 0.5 * 0.7071, 0.98, 0.78, M.CANVAS);
  for (let i = 0; i < 4; i++) sack(m, 0.3 + i * 0.09, 1.6 + (i & 1) * 0.06, 0);
  sack(m, 0.36, 1.64, 0.08);
  // Millstone leaning on the wall and a hand cart.
  m.disc(1.62, 0.55, 0.13, 0.7071, -0.7071, 0, 0.13, 0.03, M.ROCK);
  cart(m, 1.25, 1.62, M.SACK);
  banner(m, 0.38, 1.38, 0.8, 0.3, 0.13);
}

export function millLate(m: Model): void {
  m.cyl(1, 1, 0.52, 0, 0.1, M.ASHLAR);
  m.cyl(1, 1, 0.48, 0.1, 1.12, M.BYZ);
  m.op(0.4, 0.4, 1.04, 1.6, 1.6, 1.12, () => M.ASHLAR, 2);
  m.cone(1, 1, 0.6, 1.1, 0.5, 0.08, M.TILE, 0.01);
  m.op(0.3, 0.3, 0, 1.7, 1.7, 0.6, (x, y, z) => {
    const a = Math.atan2(y - 1, x - 1);
    return Math.abs(a - 0.785) < 0.16 && z > 0.1 && z < 0.5 && Math.hypot(x - 1, y - 1) > 0.38 ? 1 : 0;
  }, 1);
  m.op(0.3, 0.3, 0, 1.7, 1.7, 0.6, (x, y, z) => {
    const a = Math.atan2(y - 1, x - 1);
    const r = Math.hypot(x - 1, y - 1);
    return Math.abs(a - 0.785) < 0.16 && z < 0.5 && r > 0.38 && r < 0.42 ? M.DOOR : 0;
  }, 0);
  for (const [a, z] of [[0.2, 0.7], [1.35, 0.7], [0.785, 0.78]] as const) {
    const x = 1 + Math.cos(a) * 0.48;
    const y = 1 + Math.sin(a) * 0.48;
    m.op(x - 0.08, y - 0.08, z - 0.08, x + 0.08, y + 0.08, z + 0.12, (px, py, pz) => (Math.hypot(px - x, py - y) < 0.07 && pz < z + (Math.hypot(px - x, py - y) < 0.04 ? 0.1 : 0.05) ? 1 : 0), 1);
  }
  sails(m, 1 + 0.52 * 0.7071, 1 + 0.52 * 0.7071, 1.2, 0.85, M.CANVAS);
  // Granary annex with tiled roof.
  m.box(0.15, 1.45, 0, 0.85, 1.9, 0.1, M.ASHLAR);
  m.box(0.18, 1.48, 0.1, 0.82, 1.87, 0.42, M.PLASTER2);
  const s = m.gable(0.1, 1.4, 0.9, 1.95, 0.42, 0.2, 'x', 0.05, M.TILE, { jit: 0.01, fill: M.PLASTER2 });
  ridge(m, s, 'x', 0.1, 0.9, 1.675, M.BRICK);
  m.box(0.4, 1.85, 0.1, 0.58, 1.89, 0.36, M.DOOR);
  wallBanner(m, 'y', 0.25, 1.87, 0.4, 0.22, 0.1);
  for (let i = 0; i < 3; i++) sack(m, 1.3 + i * 0.1, 1.7 + (i & 1) * 0.05, 0);
  sack(m, 1.35, 1.74, 0.08);
  m.disc(1.65, 0.45, 0.13, 0.7071, -0.7071, 0, 0.13, 0.03, M.ROCK);
  banner(m, 1.85, 1.2, 0.9, 0.34, 0.14);
}

// ---------------------------------------------------------------------------
// Lumber camp
// ---------------------------------------------------------------------------

export function lumberEarly(m: Model): void {
  for (const [x, y] of [[0.3, 0.35], [1.7, 0.35], [0.3, 1.25], [1.7, 1.25], [1.0, 1.25]] as const) m.box(x - 0.035, y - 0.035, 0, x + 0.035, y + 0.035, 0.62, M.TIMBV);
  m.box(0.27, 0.3, 0, 1.73, 0.37, 0.6, M.PLANK);
  m.box(0.27, 0.3, 0, 0.33, 1.28, 0.6, M.PLANK);
  m.gable(0.16, 0.18, 1.84, 1.42, 0.62, 0.3, 'x', 0.06, M.SHINGLE, { sag: 0.04, jit: 0.02 });
  m.op(0.25, 0.28, 0.6, 1.75, 1.32, 0.66, (_x, y) => (Math.abs(y - 0.35) < 0.03 || Math.abs(y - 1.25) < 0.03 ? M.TIMBH : 0), 0);
  for (let r = 0; r < 4; r++) m.box(0.45, 0.45, r * 0.05, 1.2, 0.85, r * 0.05 + 0.045, M.PLANK);
  for (let r = 0; r < 3; r++) for (let k = 0; k < 4 - r; k++) logX(m, 0.25 + r * 0.03, 1.55 - r * 0.02, 1.45 + k * 0.12 + r * 0.06, 0.06 + r * 0.1, 0.06);
  m.cyl(1.72, 1.72, 0.07, 0, 0.13, (_x, _y, z) => (z > 0.115 ? M.LOGEND : M.BARK));
  m.capsule(1.7, 1.72, 0.13, 1.66, 1.68, 0.3, 0.01, 0.01, M.TOOLWOOD);
  m.box(1.66, 1.66, 0.11, 1.74, 1.69, 0.16, M.METAL);
  for (let i = 0; i < 6; i++) {
    const a = i * 1.1;
    logX(m, 1.25 + 0.1 * Math.cos(a), 1.4 + 0.1 * Math.cos(a), 1.85 + 0.06 * Math.sin(a), 0.03, 0.03);
  }
  // Team cloth awning over the open front.
  m.op(1.1, 1.25, 0.5, 1.75, 1.45, 0.62, (_x, y, z) => {
    const s = 0.6 - (y - 1.25) * 0.5;
    return z < s && z > s - 0.025 ? M.BLUE : 0;
  }, 0);
  banner(m, 1.88, 0.5, 0.75, 0.3, 0.13);
}

export function lumberLate(m: Model): void {
  m.box(0.2, 0.22, 0, 1.8, 0.95, 0.14, M.RUBBLE);
  m.box(0.22, 0.24, 0.14, 1.78, 0.4, 0.62, M.BYZ);
  m.box(0.22, 0.24, 0.14, 0.38, 0.93, 0.62, M.BYZ);
  for (const x of [0.9, 1.35, 1.75]) m.box(x - 0.04, 0.89, 0.14, x + 0.04, 0.97, 0.62, M.TIMBV);
  const s = m.gable(0.12, 0.12, 1.88, 1.06, 0.62, 0.32, 'x', 0.06, M.TILE, { sag: 0.03, jit: 0.012 });
  ridge(m, s, 'x', 0.12, 1.88, 0.59, M.BRICK);
  for (let r = 0; r < 5; r++) m.box(0.5, 0.45, 0.14 + r * 0.045, 1.6, 0.8, 0.14 + r * 0.045 + 0.04, M.PLANK);
  // Saw horse with a log and a two-man frame saw.
  for (const x of [0.5, 1.1]) {
    m.capsule(x - 0.06, 1.3, 0, x, 1.3, 0.22, 0.012, 0.012, M.OLDWOOD);
    m.capsule(x + 0.06, 1.3, 0, x, 1.3, 0.22, 0.012, 0.012, M.OLDWOOD);
  }
  logX(m, 0.3, 1.35, 1.3, 0.27, 0.055);
  m.box(0.78, 1.28, 0.1, 0.8, 1.32, 0.45, M.TOOLWOOD);
  m.box(0.72, 1.29, 0.42, 0.86, 1.31, 0.44, M.TOOLWOOD);
  m.box(0.73, 1.295, 0.1, 0.74, 1.305, 0.42, M.METAL);
  logPileY(m, 0.4, 1.5, 1.45, 3, 0.055);
  m.cyl(1.75, 1.75, 0.07, 0, 0.13, (_x, _y, z) => (z > 0.115 ? M.LOGEND : M.BARK));
  tool(m, 1.8, 1.82, 1.74, 1.74, 0.28, 'axe');
  wallBanner(m, 'y', 0.6, 0.4, 0.58, 0.28, 0.13);
  banner(m, 1.9, 0.3, 0.9, 0.32, 0.14);
  crate(m, 0.25, 1.65, 0.13);
}

// ---------------------------------------------------------------------------
// Mining camp
// ---------------------------------------------------------------------------

function orePile(m: Model, x: number, y: number, r: number, mt: number): void {
  m.op(x - r, y - r, 0, x + r, y + r, r, (px, py, pz) => {
    const d = Math.hypot(px - x, py - y) / r;
    const hgt = r * 0.75 * (1 - d * d) + 0.025 * (hash2(Math.floor(px * 40), Math.floor(py * 40)) - 0.5);
    return d < 1 && pz < hgt ? mt : 0;
  }, 0);
}

export function miningEarly(m: Model): void {
  for (const [x, y] of [[0.35, 0.35], [1.6, 0.35], [0.35, 1.1], [1.6, 1.1]] as const) m.box(x - 0.035, y - 0.035, 0, x + 0.035, y + 0.035, 0.55, M.TIMBV);
  m.box(0.32, 0.32, 0, 1.63, 0.38, 0.5, M.PLANK);
  m.hip(0.18, 0.2, 1.78, 1.25, 0.52, 0.8, 0.3, 0.1, M.THATCH, { jit: 0.035, sag: 0.03 });
  orePile(m, 0.75, 0.75, 0.3, M.ORE);
  orePile(m, 1.25, 0.7, 0.22, M.ROCK);
  cart(m, 0.35, 1.45, M.ORE);
  blockPile(m, 1.25, 1.35, 5, 0.1, M.ROCK);
  tool(m, 1.68, 1.25, 1.66, 1.17, 0.42, 'pick');
  tool(m, 1.75, 1.25, 1.73, 1.16, 0.4, 'shovel');
  barrel(m, 1.75, 0.6, 0.06, 0.14);
  m.box(0.18, 1.25, 0, 0.26, 1.33, 0.4, M.TIMBV);
  // Lantern post with team cloth.
  banner(m, 1.85, 1.75, 0.7, 0.28, 0.12);
  m.box(0.6, 0.38, 0.3, 1.2, 0.41, 0.48, M.BLUE);
}

export function miningLate(m: Model): void {
  m.box(0.2, 0.2, 0, 1.2, 1.0, 0.1, M.ASHLAR);
  m.box(0.22, 0.22, 0.1, 1.18, 0.98, 0.62, M.BYZ);
  m.hip(0.12, 0.12, 1.28, 1.08, 0.62, 0.7, 0.3, 0.07, M.TILE, { jit: 0.01 });
  m.arch('y', 0.7, 0.98, 0.12, 0.26, 0.1, 0.26, 1);
  m.archRing('y', 0.7, 0.98, 0.12, 0.26, 0.1, 0.26, 0.04, M.BRICK);
  m.arch('x', 0.6, 1.18, 0.1, 0.1, 0.36, 0.1, 1);
  wallBanner(m, 'x', 0.35, 1.18, 0.56, 0.28, 0.13);
  // Shaft head with a windlass.
  m.box(1.35, 0.3, 0, 1.85, 0.8, 0.12, M.RUBBLE);
  m.box(1.45, 0.4, 0.06, 1.75, 0.7, 0.13, M.DARK);
  for (const [x, y] of [[1.4, 0.35], [1.8, 0.75]] as const) {
    m.capsule(x, y, 0, x, y, 0.55, 0.02, 0.02, M.TIMBV);
  }
  m.capsule(1.4, 0.35, 0.5, 1.8, 0.75, 0.5, 0.035, 0.035, M.OLDWOOD);
  m.capsule(1.6, 0.55, 0.5, 1.6, 0.55, 0.15, 0.006, 0.006, M.ROPE);
  barrel(m, 1.6, 0.55, 0.05, 0.1, 0.1);
  cart(m, 0.4, 1.4, M.ORE);
  cart(m, 1.1, 1.45, M.ROCK);
  orePile(m, 1.65, 1.25, 0.25, M.ORE);
  blockPile(m, 1.45, 1.7, 6, 0.1, M.ASHLAR);
  tool(m, 0.25, 1.25, 0.23, 1.17, 0.42, 'pick');
  banner(m, 1.9, 0.95, 0.9, 0.32, 0.14);
}

// ---------------------------------------------------------------------------
// Farm
// ---------------------------------------------------------------------------

function furrowsAndCrops(m: Model, x0: number, y0: number, x1: number, y1: number, seed: number): void {
  const R = m.res;
  m.op(x0, y0, 0, x1, y1, 0.05, (x, y, z) => {
    const fr = fract((y - y0) / 0.125);
    const hgt = 0.012 + 0.024 * Math.sin(fr * Math.PI);
    const e = Math.min(x - x0, x1 - x, y - y0, y1 - y) + (hash2(Math.floor(x * 20), Math.floor(y * 20)) - 0.5) * 0.04;
    if (e < 0) return 0;
    return z < hgt ? M.FURROW : 0;
  }, 0);
  // Crops on the ridges: ripe grain at the back, young shoots in the middle, bare furrows at the front.
  const rows = Math.floor((y1 - y0) / 0.125);
  m.op(x0, y0, 0.02, x1, y1, 0.24, (x, y, z) => {
    const row = Math.floor((y - y0) / 0.125);
    const ry = y0 + (row + 0.5) * 0.125;
    if (x < x0 + 0.08 || x > x1 - 0.08) return 0;
    const f = row / rows;
    const stage = f < 0.45 ? 2 : f < 0.75 ? 1 : hash2(row, seed) < 0.4 ? 0 : -1;
    if (stage < 0) return 0;
    const hh = [0.04, 0.08, 0.17][stage]! * (0.65 + 0.6 * hash2(Math.floor(x * 14), row));
    const w = [0.014, 0.02, 0.034][stage]! * (1 - (0.5 * (z - 0.02)) / hh);
    if (Math.abs(y - ry) > w || z - 0.02 > hh) return 0;
    if (hash2(Math.floor(x * R) * 7 + Math.floor(z * R), Math.floor(y * R)) < (stage === 2 ? 0.25 : 0.5)) return 0;
    if (stage === 1 && fract(x * 9 + hash2(row, 3)) > 0.55) return 0;
    return stage === 2 ? (z - 0.02 > hh * 0.45 ? M.CROP2 : M.CROP) : M.CROP;
  }, 0);
}

function scarecrow(m: Model, x: number, y: number): void {
  m.capsule(x, y, 0, x, y, 0.42, 0.012, 0.012, M.OLDWOOD);
  m.capsule(x - 0.1, y + 0.1, 0.34, x + 0.1, y - 0.1, 0.34, 0.01, 0.01, M.OLDWOOD);
  m.capsule(x, y, 0.22, x, y, 0.34, 0.045, 0.05, M.BLUE);
  m.sphere(x, y, 0.4, 0.035, 0.035, 0.035, M.SACK);
  m.disc(x, y, 0.44, 0, 0, 1, 0.06, 0.008, M.STRAW);
}

export function farmEarly(m: Model): void {
  furrowsAndCrops(m, 0.08, 0.08, 1.92, 1.92, 5);
  wattle(m, 0.03, 0.03, 1.97, 0.03, 0.18);
  wattle(m, 0.03, 0.03, 0.03, 1.97, 0.18);
  scarecrow(m, 1.0, 0.95);
  sack(m, 1.92, 1.95, 0);
  m.capsule(1.75, 2.02, 0, 1.95, 1.75, 0.03, 0.01, 0.01, M.TOOLWOOD);
}

export function farmLate(m: Model): void {
  furrowsAndCrops(m, 0.12, 0.12, 1.92, 1.92, 9);
  // Dry-stone boundary on the back edges and a little well in the corner.
  m.box(0.0, 0.0, 0, 2.0, 0.1, 0.15, M.RUBBLE);
  m.box(0.0, 0.0, 0, 0.1, 2.0, 0.15, M.RUBBLE);
  m.cyl(0.3, 0.3, 0.13, 0, 0.2, M.RUBBLE);
  m.cyl(0.3, 0.3, 0.09, 0.14, 0.21, M.WATER);
  m.capsule(0.2, 0.2, 0.2, 0.2, 0.2, 0.45, 0.012, 0.012, M.OLDWOOD);
  m.capsule(0.4, 0.4, 0.2, 0.4, 0.4, 0.45, 0.012, 0.012, M.OLDWOOD);
  m.gable(0.14, 0.14, 0.46, 0.46, 0.43, 0.1, 'x', 0.025, M.TILE);
  banner(m, 1.94, 0.12, 0.55, 0.24, 0.11);
  scarecrow(m, 1.15, 1.0);
}

// ---------------------------------------------------------------------------
// Barracks
// ---------------------------------------------------------------------------

function weaponRack(m: Model, x0: number, y: number, n: number): void {
  m.box(x0 - 0.05, y, 0.25, x0 + n * 0.1, y + 0.03, 0.28, M.TIMBH);
  for (let i = 0; i < n; i++) {
    const x = x0 + i * 0.1;
    m.capsule(x, y + 0.02, 0, x + 0.02, y - 0.02, 0.52, 0.008, 0.008, M.TOOLWOOD);
    m.capsule(x + 0.02, y - 0.02, 0.52, x + 0.024, y - 0.025, 0.6, 0.013, 0.002, M.METAL);
  }
}

function dummy(m: Model, x: number, y: number): void {
  m.box(x - 0.025, y - 0.025, 0, x + 0.025, y + 0.025, 0.42, M.OLDWOOD);
  m.capsule(x - 0.12, y, 0.33, x + 0.12, y, 0.33, 0.012, 0.012, M.OLDWOOD);
  m.sphere(x, y, 0.3, 0.055, 0.055, 0.085, M.STRAW);
  m.sphere(x, y, 0.42, 0.035, 0.035, 0.035, M.SACK);
}

function shield(m: Model, axis: 'x' | 'y', c: number, wpos: number, z: number): void {
  if (axis === 'y') m.disc(c, wpos + 0.015, z, 0, 1, 0, 0.07, 0.012, M.BLUEPAINT, M.IRONDARK, M.METAL);
  else m.disc(wpos + 0.015, c, z, 1, 0, 0, 0.07, 0.012, M.BLUEPAINT, M.IRONDARK, M.METAL);
}

export function barracksEarly(m: Model): void {
  m.box(0.25, 0.3, 0, 2.75, 1.5, 0.16, M.RUBBLE);
  m.box(0.3, 0.35, 0.16, 2.7, 1.45, 0.66, M.DAUB);
  for (let x = 0.3; x <= 2.71; x += 0.4) m.box(x - 0.03, 1.43, 0.16, x + 0.03, 1.49, 0.66, M.TIMBV);
  for (let y = 0.35; y <= 1.46; y += 0.37) m.box(2.68, y - 0.03, 0.16, 2.74, y + 0.03, 0.66, M.TIMBV);
  m.box(0.3, 1.43, 0.6, 2.72, 1.5, 0.66, M.TIMBH);
  m.box(2.68, 0.35, 0.6, 2.75, 1.48, 0.66, M.TIMBH);
  m.gable(0.15, 0.18, 2.85, 1.62, 0.62, 0.62, 'x', 0.13, M.THATCH, { sag: 0.06, jit: 0.04, js: 7, fill: M.DAUB });
  m.box(1.3, 1.42, 0.16, 1.7, 1.5, 0.56, M.DOOR);
  m.carveBox(1.3, 1.47, 0.16, 1.7, 1.52, 0.56);
  m.box(1.26, 1.47, 0.56, 1.74, 1.53, 0.6, M.TIMBH);
  for (const x of [0.7, 2.1]) shield(m, 'y', x, 1.49, 0.42);
  shield(m, 'x', 0.9, 2.74, 0.42);
  // Palisade yard, training dummy, weapon rack.
  palisade(m, 0.2, 2.9, 1.3, 2.9, 0.36);
  palisade(m, 2.9, 1.7, 2.9, 2.9, 0.36);
  dummy(m, 2.2, 2.2);
  dummy(m, 1.55, 2.35);
  weaponRack(m, 0.5, 1.75, 5);
  m.disc(1.1, 1.76, 0.12, 0, 1, 0, 0.07, 0.012, M.BLUEPAINT, M.IRONDARK, M.METAL);
  banner(m, 2.85, 1.65, 0.95, 0.4, 0.16);
  barrel(m, 0.4, 2.6, 0.06, 0.14);
  crate(m, 0.55, 2.55, 0.11);
}

export function barracksLate(m: Model): void {
  m.box(0.22, 0.22, 0, 2.78, 1.58, 0.1, M.ASHLAR);
  m.box(0.25, 0.25, 0.1, 2.75, 1.55, 0.82, M.BYZ);
  m.box(0.22, 0.22, 0.78, 2.78, 1.58, 0.82, M.ASHLAR);
  const bs = m.gable(0.13, 0.13, 2.87, 1.67, 0.82, 0.44, 'x', 0.07, M.TILE, { sag: 0.04, jit: 0.014, fill: M.BYZ });
  ridge(m, bs, 'x', 0.13, 2.87, 0.9, M.BRICK);
  for (const x of [0.6, 1.0, 2.0, 2.4]) {
    m.arch('y', x, 1.55, 0.12, 0.12, 0.38, 0.16, 1);
    m.archRing('y', x, 1.55, 0.12, 0.12, 0.38, 0.16, 0.03, M.BRICK);
  }
  m.arch('y', 1.5, 1.55, 0.12, 0.34, 0.1, 0.34, 1);
  m.archRing('y', 1.5, 1.55, 0.12, 0.34, 0.1, 0.34, 0.05, M.BRICK);
  m.box(1.33, 1.44, 0.1, 1.67, 1.47, 0.6, M.DOOR);
  for (const y of [0.55, 0.9, 1.25]) {
    m.arch('x', y, 2.75, 0.12, 0.1, 0.4, 0.16, 1);
    m.archRing('x', y, 2.75, 0.12, 0.1, 0.4, 0.16, 0.03, M.BRICK);
  }
  // Corner tower.
  m.box(0.2, 1.55, 0, 0.95, 2.3, 1.25, M.BYZ);
  m.box(0.17, 1.52, 1.18, 0.98, 2.33, 1.25, M.ASHLAR);
  m.hip(0.12, 1.47, 1.03, 2.38, 1.25, 1.0, 0.4, 0.07, M.TILE, { jit: 0.01 });
  m.arch('y', 0.575, 2.3, 0.12, 0.12, 0.85, 0.16, 1);
  m.arch('x', 1.925, 0.95, 0.12, 0.12, 0.85, 0.16, 1);
  m.box(0.45, 2.27, 0, 0.7, 2.31, 0.42, M.DOOR);
  wallBanner(m, 'y', 0.575, 2.3, 0.78, 0.34, 0.15);
  wallBanner(m, 'x', 1.925, 0.95, 0.78, 0.34, 0.15);
  // Yard: stone kerb, training post, rack, shields.
  m.box(1.1, 2.8, 0, 2.9, 2.9, 0.12, M.RUBBLE);
  m.box(2.8, 1.7, 0, 2.9, 2.9, 0.12, M.RUBBLE);
  dummy(m, 2.25, 2.2);
  weaponRack(m, 1.3, 1.72, 6);
  for (const x of [0.8, 2.2]) shield(m, 'y', x, 1.55, 0.6);
  banner(m, 2.92, 1.7, 1.0, 0.42, 0.17);
  barrel(m, 1.2, 2.5, 0.06, 0.14);
}

// ---------------------------------------------------------------------------
// Archery range
// ---------------------------------------------------------------------------

function bowRack(m: Model, x0: number, y: number, n: number): void {
  m.box(x0 - 0.04, y, 0.3, x0 + n * 0.09, y + 0.03, 0.33, M.TIMBH);
  for (const x of [x0 - 0.03, x0 + n * 0.09 - 0.02]) m.box(x, y, 0, x + 0.03, y + 0.03, 0.42, M.OLDWOOD);
  for (let i = 0; i < n; i++) {
    const x = x0 + i * 0.09 + 0.02;
    m.op(x - 0.05, y - 0.04, 0.05, x + 0.05, y + 0.06, 0.45, (px, py, pz) => {
      if (Math.abs(py - (y - 0.01)) > 0.012) return 0;
      const t = (pz - 0.25) / 0.2;
      const bowX = x + 0.035 * (1 - t * t);
      if (Math.abs(t) <= 1 && Math.abs(px - bowX) < 0.012) return M.TOOLWOOD;
      if (Math.abs(t) <= 1 && Math.abs(px - x) < 0.004) return M.LINEN;
      return 0;
    }, 0);
  }
}

export function archeryEarly(m: Model): void {
  // Open timber shooting shed at the back.
  for (const [x, y] of [[0.25, 0.25], [1.25, 0.25], [2.25, 0.25], [0.25, 1.0], [1.25, 1.0], [2.25, 1.0]] as const) m.box(x - 0.035, y - 0.035, 0, x + 0.035, y + 0.035, 0.6, M.TIMBV);
  m.box(0.22, 0.22, 0, 2.28, 0.28, 0.55, M.PLANK);
  m.box(0.22, 0.22, 0.56, 2.3, 1.05, 0.6, M.TIMBH);
  m.gable(0.12, 0.1, 2.4, 1.16, 0.6, 0.32, 'x', 0.06, M.SHINGLE, { sag: 0.04, jit: 0.02 });
  bowRack(m, 0.5, 0.35, 6);
  barrel(m, 1.6, 0.5, 0.06, 0.15);
  for (let i = 0; i < 5; i++) m.capsule(1.6 + (i - 2) * 0.015, 0.5, 0.12, 1.6 + (i - 2) * 0.03, 0.5 - 0.02, 0.28, 0.004, 0.004, M.TOOLWOOD);
  // Shooting line and butts down the range.
  m.box(0.3, 1.25, 0, 2.7, 1.29, 0.02, M.OLDWOOD);
  butt(m, 0.55, 2.5, 0.16);
  butt(m, 1.25, 2.55, 0.16);
  butt(m, 1.95, 2.6, 0.16);
  m.op(0.25, 2.6, 0, 2.6, 2.95, 0.34, (x, y, z) => {
    const s = 0.3 + 0.04 * Math.sin(x * 9);
    return y > 2.8 && y < 2.92 && z < s ? M.EARTH : 0;
  }, 0);
  fence(m, 2.85, 1.2, 2.85, 2.9, 0.22);
  banner(m, 2.6, 1.15, 0.95, 0.4, 0.16);
}

export function archeryLate(m: Model): void {
  m.box(0.15, 0.15, 0, 2.6, 1.15, 0.08, M.ASHLAR);
  m.box(0.18, 0.18, 0.08, 2.57, 0.4, 0.82, M.BYZ);
  m.box(0.18, 0.18, 0.08, 0.4, 1.12, 0.82, M.BYZ);
  for (const x of [0.95, 1.65, 2.35]) m.box(x - 0.08, 0.92, 0.08, x + 0.08, 1.08, 0.74, M.BYZ);
  m.box(0.4, 0.92, 0.68, 2.57, 1.1, 0.8, M.BYZ);
  for (const c of [0.65, 1.3, 2.0]) {
    m.arch('y', c, 1.1, 0.2, 0.5, 0.08, 0.32, 1);
    m.archRing('y', c, 1.1, 0.2, 0.5, 0.08, 0.32, 0.05, M.BRICK);
  }
  m.box(0.15, 0.15, 0.78, 2.62, 1.15, 0.82, M.ASHLAR);
  // Lean-to loggia roof falling towards the range, and a square target store with a pyramid roof at the end.
  m.op(0.08, 0.08, 0.7, 2.68, 1.26, 1.2, (x, y, z) => {
    const sz = 1.12 - (y - 0.08) * 0.33;
    return z <= sz && z > sz - 0.06 && x >= 0.08 && x < 2.68 ? M.TILE : 0;
  }, 0);
  m.box(0.15, 0.15, 0.8, 2.6, 0.3, 1.12, M.BYZ);
  m.box(1.95, 1.3, 0, 2.75, 2.1, 1.0, M.BYZ);
  m.box(1.92, 1.27, 0.95, 2.78, 2.13, 1.0, M.ASHLAR);
  m.hip(1.88, 1.23, 2.82, 2.17, 1.0, 1.2, 0.42, 0.07, M.TILE, { jit: 0.01 });
  m.arch('y', 2.35, 2.1, 0.12, 0.24, 0.0, 0.3, 1);
  m.archRing('y', 2.35, 2.1, 0.12, 0.24, 0.0, 0.3, 0.04, M.BRICK);
  m.arch('x', 1.7, 2.75, 0.12, 0.12, 0.6, 0.14, 1);
  wallBanner(m, 'x', 1.5, 2.75, 0.9, 0.36, 0.15);
  for (let i = 0; i < 3; i++) butt(m, 2.0 + i * 0.25, 2.35 + i * 0.05, 0.08);
  bowRack(m, 0.6, 0.45, 7);
  wallBanner(m, 'x', 0.65, 2.57, 0.74, 0.3, 0.14);
  // Range: sanded lane, butts in a turf bank.
  m.box(0.3, 1.3, 0, 2.7, 1.34, 0.02, M.ASHLAR);
  m.op(0.2, 2.7, 0, 2.7, 3.0, 0.38, (x, y, z) => (y > 2.78 && z < 0.34 - (y - 2.78) * 0.6 + 0.03 * Math.sin(x * 11) ? M.EARTH : 0), 0);
  butt(m, 0.5, 2.45, 0.2);
  butt(m, 1.2, 2.5, 0.2);
  barrel(m, 1.75, 1.45, 0.06, 0.15);
  banner(m, 2.8, 1.25, 1.05, 0.44, 0.17);
}

// ---------------------------------------------------------------------------
// Stable
// ---------------------------------------------------------------------------

function hayBale(m: Model, x: number, y: number, z = 0): void {
  m.box(x, y, z, x + 0.2, y + 0.13, z + 0.12, M.HAY);
  m.box(x + 0.05, y - 0.005, z, x + 0.06, y + 0.135, z + 0.121, M.ROPE);
  m.box(x + 0.14, y - 0.005, z, x + 0.15, y + 0.135, z + 0.121, M.ROPE);
}

function trough(m: Model, x: number, y: number, len: number, alongX: boolean): void {
  const x1 = alongX ? x + len : x + 0.1;
  const y1 = alongX ? y + 0.1 : y + len;
  m.box(x, y, 0, x1, y1, 0.1, M.PLANK);
  m.box(x + 0.015, y + 0.015, 0.06, x1 - 0.015, y1 - 0.015, 0.1, M.WATER);
}

export function stableEarly(m: Model): void {
  m.box(0.25, 0.25, 0, 2.75, 1.0, 0.12, M.RUBBLE);
  m.box(0.27, 0.27, 0.12, 2.73, 0.36, 0.55, M.PLANK);
  m.box(0.27, 0.27, 0.12, 0.36, 0.98, 0.55, M.PLANK);
  for (let x = 0.3; x <= 2.75; x += 0.48) {
    m.box(x - 0.035, 0.95, 0, x + 0.035, 1.02, 0.6, M.TIMBV);
    m.box(x - 0.012, 0.36, 0.12, x + 0.012, 0.95, 0.38, M.PLANK);
  }
  m.hip(0.12, 0.12, 2.88, 1.18, 0.56, 0.75, 0.38, 0.12, M.THATCH, { jit: 0.04, sag: 0.04 });
  for (const x of [0.75, 1.75]) hayBale(m, x, 0.45, 0.12);
  hayBale(m, 2.2, 0.45, 0.12);
  hayBale(m, 2.2, 0.47, 0.24);
  // Paddock with a horse, trough and hay.
  fence(m, 0.2, 2.85, 2.85, 2.85, 0.26);
  fence(m, 2.85, 1.25, 2.85, 2.85, 0.26);
  horse(m, 1.6, 2.0, 0.6, M.HORSE);
  trough(m, 0.4, 2.55, 0.6, true);
  hayBale(m, 2.35, 1.45);
  hayBale(m, 2.4, 1.6, 0.12);
  m.op(0.3, 1.3, 0, 0.8, 1.8, 0.1, (x, y, z) => {
    const d = Math.hypot(x - 0.55, y - 1.55);
    return d < 0.22 && z < 0.08 * (1 - d / 0.22) ? M.STRAW : 0;
  }, 0);
  wallBanner(m, 'y', 1.25, 1.02, 0.55, 0.26, 0.13);
  banner(m, 2.9, 1.15, 0.9, 0.38, 0.15);
}

export function stableLate(m: Model): void {
  m.box(0.18, 0.18, 0, 2.82, 1.2, 0.08, M.ASHLAR);
  m.box(0.2, 0.2, 0.08, 2.8, 1.18, 0.78, M.BYZ);
  m.box(0.17, 0.17, 0.74, 2.83, 1.21, 0.78, M.ASHLAR);
  const s = m.gable(0.1, 0.1, 2.9, 1.28, 0.78, 0.42, 'x', 0.07, M.TILE, { sag: 0.035, jit: 0.014, fill: M.BYZ });
  ridge(m, s, 'x', 0.1, 2.9, 0.69, M.BRICK);
  for (const c of [0.55, 1.05, 1.95, 2.45]) {
    m.arch('y', c, 1.18, 0.14, 0.3, 0.08, 0.22, 1);
    m.archRing('y', c, 1.18, 0.14, 0.3, 0.08, 0.22, 0.04, M.BRICK);
    m.box(c - 0.15, 1.12, 0.08, c + 0.15, 1.16, 0.26, M.PLANK);
  }
  // Central hayloft gable with door and hoist beam.
  m.box(1.25, 1.1, 0.08, 1.75, 1.3, 1.05, M.BYZ);
  m.gable(1.18, 1.0, 1.82, 1.4, 1.05, 0.25, 'y', 0.06, M.TILE, { jit: 0.01 });
  m.box(1.38, 1.28, 0.08, 1.62, 1.32, 0.55, M.DOOR);
  m.box(1.4, 1.28, 0.72, 1.6, 1.32, 0.94, M.DARK);
  m.box(1.42, 1.25, 0.72, 1.58, 1.3, 0.82, M.HAY);
  m.box(1.48, 1.3, 1.0, 1.52, 1.5, 1.04, M.TIMBH);
  m.capsule(1.5, 1.48, 1.0, 1.5, 1.48, 0.7, 0.005, 0.005, M.ROPE);
  wallBanner(m, 'y', 1.5, 1.32, 0.66, 0.08, 0.2);
  for (const y of [0.5, 0.9]) {
    m.arch('x', y, 2.8, 0.12, 0.1, 0.38, 0.14, 1);
    m.archRing('x', y, 2.8, 0.12, 0.1, 0.38, 0.14, 0.03, M.BRICK);
  }
  // Paddock with stone posts, two horses, trough.
  for (let x = 0.3; x < 2.9; x += 0.5) m.box(x - 0.04, 2.81, 0, x + 0.04, 2.89, 0.28, M.ASHLAR);
  for (let y = 1.4; y < 2.9; y += 0.5) m.box(2.81, y - 0.04, 0, 2.89, y + 0.04, 0.28, M.ASHLAR);
  m.capsule(0.3, 2.85, 0.22, 2.85, 2.85, 0.22, 0.014, 0.014, M.OLDWOOD);
  m.capsule(2.85, 1.4, 0.22, 2.85, 2.85, 0.22, 0.014, 0.014, M.OLDWOOD);
  horse(m, 1.2, 2.1, 0.4, M.HORSE);
  horse(m, 2.1, 1.85, 2.3, M.HORSEGREY);
  trough(m, 0.35, 1.45, 0.7, true);
  hayBale(m, 2.45, 2.4);
  banner(m, 2.92, 1.3, 1.05, 0.42, 0.17);
}

// ---------------------------------------------------------------------------
// Siege workshop (Citadel and Empire only)
// ---------------------------------------------------------------------------

export function siegeWorkshop(m: Model): void {
  // Open hall: stone piers and back wall, big tiled roof.
  m.box(0.15, 0.15, 0, 2.85, 1.45, 0.08, M.ASHLAR);
  m.box(0.17, 0.17, 0.08, 2.83, 0.35, 0.95, M.BYZ);
  m.box(0.17, 0.17, 0.08, 0.35, 1.43, 0.95, M.BYZ);
  for (const x of [1.05, 1.95, 2.75]) m.box(x - 0.09, 1.27, 0.08, x + 0.09, 1.45, 0.95, M.BYZ);
  m.box(2.66, 0.35, 0.08, 2.84, 0.55, 0.95, M.BYZ);
  m.box(0.35, 1.27, 0.86, 2.84, 1.45, 0.95, M.TIMBH);
  // Steep timber-shingled workshop roof (the hall is a workshop, not a dwelling).
  const s = m.gable(0.06, 0.06, 2.94, 1.56, 0.95, 0.72, 'x', 0.08, M.SHINGLE, { sag: 0.05, jit: 0.02 });
  ridge(m, s, 'x', 0.06, 2.94, 0.81, M.TIMBH);
  // Inside: timber A-frames.
  for (const x of [0.75, 1.5, 2.25]) {
    m.capsule(x - 0.2, 0.5, 0.08, x, 0.8, 0.85, 0.022, 0.022, M.TIMBV);
    m.capsule(x + 0.2, 0.5, 0.08, x, 0.8, 0.85, 0.022, 0.022, M.TIMBV);
  }
  // Yard: a half-built trebuchet frame (big enough to read at 1x) and ram wheels, logs, a treadwheel crane.
  const tx = 1.25;
  const ty = 2.25;
  for (const dy of [-0.24, 0.24]) {
    m.capsule(tx - 0.55, ty + dy, 0.04, tx + 0.55, ty + dy, 0.04, 0.04, 0.04, M.TIMBH);
    m.capsule(tx - 0.42, ty + dy, 0.04, tx, ty + dy * 0.6, 1.05, 0.035, 0.03, M.TIMBV);
    m.capsule(tx + 0.42, ty + dy, 0.04, tx, ty + dy * 0.6, 1.05, 0.035, 0.03, M.TIMBV);
    m.capsule(tx - 0.22, ty + dy, 0.5, tx + 0.22, ty + dy, 0.5, 0.025, 0.025, M.TIMBH);
  }
  m.capsule(tx - 0.55, ty - 0.24, 0.04, tx - 0.55, ty + 0.24, 0.04, 0.04, 0.04, M.TIMBH);
  m.capsule(tx + 0.55, ty - 0.24, 0.04, tx + 0.55, ty + 0.24, 0.04, 0.04, 0.04, M.TIMBH);
  m.capsule(tx, ty - 0.18, 1.06, tx, ty + 0.18, 1.06, 0.03, 0.03, M.IRONDARK);
  m.capsule(tx - 0.95, ty, 0.12, tx + 0.45, ty, 1.4, 0.04, 0.026, M.TIMBH);
  m.capsule(tx - 0.95, ty, 0.12, tx - 0.95, ty, 0.0, 0.006, 0.006, M.ROPE);
  ladderLean(m, tx + 0.7, ty + 0.3, tx + 0.35, ty + 0.2, 0.9);
  for (const [wx, wy] of [[0.45, 2.75], [0.62, 2.85]] as const) m.disc(wx, wy, 0.13, 0.7071, 0.7071, 0, 0.12, 0.022, M.PLANK, M.IRONDARK, M.IRONDARK);
  logPileX(m, 2.0, 2.8, 1.7, 3, 0.05);
  // Treadwheel crane.
  const cx = 2.5;
  const cy = 2.55;
  m.op(cx - 0.4, cy - 0.06, 0, cx + 0.4, cy + 0.06, 0.8, (x, y, z) => {
    if (Math.abs(y - cy) > 0.05) return 0;
    const r = Math.hypot(x - cx, z - 0.38);
    const a = Math.atan2(z - 0.38, x - cx);
    if (r < 0.36 && r > 0.32) return M.TOOLWOOD;
    if (r < 0.34 && Math.abs(fract((a / Math.PI) * 4 + 0.5) - 0.5) < 0.06) return M.TOOLWOOD;
    return 0;
  }, 0);
  m.capsule(cx - 0.2, cy, 0, cx, cy, 0.38, 0.018, 0.018, M.TIMBV);
  m.capsule(cx + 0.2, cy, 0, cx, cy, 0.38, 0.018, 0.018, M.TIMBV);
  m.capsule(cx, cy, 0.38, cx - 0.3, cy - 0.4, 0.95, 0.02, 0.016, M.TIMBH);
  m.capsule(cx - 0.3, cy - 0.4, 0.95, cx - 0.3, cy - 0.4, 0.55, 0.005, 0.005, M.ROPE);
  m.box(cx - 0.35, cy - 0.45, 0.48, cx - 0.25, cy - 0.35, 0.55, M.ROCK);
  wallBanner(m, 'x', 0.75, 2.84, 0.85, 0.34, 0.15);
  banner(m, 2.92, 1.55, 1.05, 0.42, 0.17);
}

// ---------------------------------------------------------------------------
// Silk workshop (Byzantine unique, Citadel and Empire)
// ---------------------------------------------------------------------------

function vat(m: Model, x: number, y: number, dye: number): void {
  m.cyl(x, y, 0.16, 0, 0.2, M.BRICK);
  m.cyl(x, y, 0.12, 0.12, 0.2, dye);
  m.cyl(x, y, 0.1, 0.0, 0.17, M.DARK);
}

export function silkWorkshop(m: Model): void {
  m.box(0.15, 0.15, 0, 2.0, 1.4, 0.08, M.ASHLAR);
  m.box(0.18, 0.18, 0.08, 1.97, 1.37, 0.9, M.PLASTER);
  m.box(0.15, 0.15, 0.08, 1.99, 1.4, 0.24, M.BYZ);
  m.box(0.15, 0.15, 0.82, 1.99, 1.4, 0.9, M.BRICK);
  const s = m.gable(0.06, 0.06, 2.08, 1.5, 0.9, 0.42, 'x', 0.07, M.TILE, { sag: 0.03, jit: 0.012, fill: M.PLASTER });
  ridge(m, s, 'x', 0.06, 2.08, 0.78, M.BRICK);
  for (const x of [0.5, 1.05, 1.6]) {
    m.arch('y', x, 1.37, 0.12, 0.2, 0.08, 0.3, 1);
    m.archRing('y', x, 1.37, 0.12, 0.2, 0.08, 0.3, 0.04, M.BRICK);
  }
  m.arch('x', 0.75, 1.97, 0.12, 0.12, 0.42, 0.16, 1);
  m.archRing('x', 0.75, 1.97, 0.12, 0.12, 0.42, 0.16, 0.03, M.BRICK);
  // Awning of striped cloth over the arcade.
  m.op(0.2, 1.37, 0.6, 1.95, 1.75, 0.76, (x, y, z) => {
    const sz = 0.74 - (y - 1.37) * 0.38;
    if (z > sz || z < sz - 0.025) return 0;
    return Math.floor(x / 0.12) % 2 === 0 ? M.DYE_YELLOW : M.BLUE;
  }, 0);
  for (const x of [0.25, 1.9]) m.capsule(x, 1.73, 0, x, 1.73, 0.62, 0.012, 0.012, M.TOOLWOOD);
  // Courtyard: dye vats and drying racks with hanging cloth.
  vat(m, 2.35, 0.45, M.DYE_RED);
  vat(m, 2.6, 0.85, M.DYE_YELLOW);
  vat(m, 2.35, 1.25, M.BLUE);
  const racks: [number, number, number][] = [
    [0.55, 2.25, M.DYE_RED],
    [1.2, 2.35, M.BLUE],
    [1.85, 2.45, M.DYE_YELLOW],
    [2.45, 2.2, M.DYE_GREEN],
  ];
  for (let i = 0; i < racks.length; i++) {
    const [x, y, c] = racks[i]!;
    const d = 0.7071 * 0.2;
    m.capsule(x - d, y + d, 0, x - d, y + d, 0.62, 0.012, 0.012, M.TOOLWOOD);
    m.capsule(x + d, y - d, 0, x + d, y - d, 0.62, 0.012, 0.012, M.TOOLWOOD);
    m.capsule(x - d, y + d, 0.6, x + d, y - d, 0.6, 0.01, 0.01, M.TOOLWOOD);
    clothPanel(m, x, y, 0.36, 0.59, 0.4 + 0.05 * (i & 1), c);
  }
  // Bolts of cloth and a loom frame by the door.
  for (let i = 0; i < 3; i++) logX(m, 0.3, 0.6, 1.62 + i * 0.07, 0.04, 0.035);
  m.box(0.36, 1.6, 0.0, 0.54, 1.82, 0.0001, M.LINEN);
  for (const [i, c] of [[0, M.DYE_RED], [1, M.DYE_YELLOW], [2, M.BLUE]] as const) m.cyl(0.3 + i * 0.1, 1.95, 0.035, 0, 0.3, c);
  banner(m, 2.85, 1.6, 1.0, 0.4, 0.16);
}

