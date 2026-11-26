/** Resource nodes: trees (oak, cypress, olive, stone pine), berry bushes, gold and stone deposits. */

import { M } from '../materials';
import { hash3, rng, vn3 } from '../noise';
import { Model } from '../voxel';

export type TreeKind = 'oak' | 'cypress' | 'olive' | 'pine';

function addTree(m: Model, x: number, y: number, type: TreeKind, size: number, r: () => number): void {
  const R = m.res;
  const hole = (lx: number, ly: number, lz: number): number => hash3(Math.floor(lx * R * 0.8), Math.floor(ly * R * 0.8), Math.floor(lz * R * 0.8));
  const clump = (px: number, py: number, pz: number, rad: number, mat: number, holes: number): void => {
    m.op(px - rad, py - rad, pz - rad, px + rad, py + rad, pz + rad, (lx, ly, lz) => {
      const dx = lx - px;
      const dy = ly - py;
      const dz = lz - pz;
      const d2 = (dx * dx + dy * dy + dz * dz) / (rad * rad);
      if (d2 > 1) return 0;
      const d3 = (vn3(lx * 26, ly * 26, lz * 26) - 0.5) * 0.7;
      if (d2 > 0.75 + d3) return 0;
      if (d2 > 0.35 && hole(lx, ly, lz) < holes) return 0;
      return mat;
    }, 0);
  };
  const crown = (cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, n: number, r0: number, r1: number, mat: number, holes: number): void => {
    for (let i = 0; i < n; i++) {
      let u: number;
      let v: number;
      let w: number;
      do {
        u = r() * 2 - 1;
        v = r() * 2 - 1;
        w = r() * 2 - 1;
      } while (u * u + v * v + w * w > 1);
      const l = Math.sqrt(u * u + v * v + w * w) || 1;
      const k = Math.pow(l, 0.35) / l;
      u *= k;
      v *= k;
      w *= k;
      if (w < -0.6) w = -0.6 + (w + 0.6) * 0.3;
      clump(cx + u * rx, cy + v * ry, cz + w * rz, (r0 + (r1 - r0) * r()) * size, mat, holes);
    }
  };
  if (type === 'oak') {
    const th = 0.55 * size;
    const lx = (r() - 0.5) * 0.14;
    const ly = (r() - 0.5) * 0.14;
    m.capsule(x, y, 0, x + lx, y + ly, th, 0.075 * size, 0.055 * size, M.BARK);
    for (let i = 0; i < 4; i++) {
      const a = r() * 6.28;
      m.capsule(x, y, 0.03, x + Math.cos(a) * 0.13 * size, y + Math.sin(a) * 0.13 * size, 0, 0.045 * size, 0.02 * size, M.BARK);
    }
    const cz = 1.0 * size;
    const cxx = x + lx * 1.4;
    const cyy = y + ly * 1.4;
    for (let i = 0; i < 6; i++) {
      const a = r() * 6.28;
      m.capsule(x + lx, y + ly, th * 0.85, cxx + Math.cos(a) * 0.3 * size, cyy + Math.sin(a) * 0.3 * size, cz + (r() - 0.4) * 0.3 * size, 0.04 * size, 0.015 * size, M.BARK);
    }
    const mat = r() < 0.12 ? M.LEAF_DRY : M.LEAF_OAK;
    const rx = (0.4 + r() * 0.1) * size;
    const ry = (0.4 + r() * 0.1) * size;
    crown(cxx, cyy, cz, rx, ry, 0.33 * size, 72, 0.075, 0.13, mat, 0.45);
  } else if (type === 'cypress') {
    m.capsule(x, y, 0, x, y, 0.35 * size, 0.045 * size, 0.035 * size, M.BARK);
    const cz = 0.85 * size;
    const H = 0.68 * size;
    m.op(x - 0.15 * size, y - 0.15 * size, cz - H, x + 0.15 * size, y + 0.15 * size, cz + H, (qx, qy, qz) => {
      const t = (qz - cz) / H;
      if (t < -1 || t > 1) return 0;
      const prof = t < 0 ? Math.sqrt(1 - t * t * 0.7) : Math.sqrt(Math.max(0, 1 - t));
      const rr = 0.1 * size * prof;
      return (qx - x) * (qx - x) + (qy - y) * (qy - y) < rr * rr ? M.LEAF_CYP : 0;
    }, 0);
    for (let i = 0; i < 46; i++) {
      const t = r() * 2 - 1;
      const prof = t < 0 ? Math.sqrt(1 - t * t * 0.7) : Math.sqrt(Math.max(0, 1 - t));
      const rr = 0.13 * size * prof;
      const a = r() * 6.28;
      const rad = rr * (0.6 + 0.4 * Math.sqrt(r()));
      clump(x + Math.cos(a) * rad, y + Math.sin(a) * rad, cz + t * H, (0.05 + 0.035 * r()) * size, M.LEAF_CYP, 0.45);
    }
  } else if (type === 'olive') {
    const th = 0.34 * size;
    for (let k = 0; k < 3; k++) {
      const a = r() * 6.28;
      const rr = 0.09 * size;
      m.capsule(x + Math.cos(a) * 0.04, y + Math.sin(a) * 0.04, 0, x + Math.cos(a + 1.2) * rr, y + Math.sin(a + 1.2) * rr, th, 0.05 * size, 0.032 * size, M.BARK);
    }
    for (let i = 0; i < 6; i++) {
      const a = r() * 6.28;
      m.capsule(x, y, th, x + Math.cos(a) * 0.34 * size, y + Math.sin(a) * 0.34 * size, th + 0.28 * size, 0.032 * size, 0.012 * size, M.BARK);
    }
    crown(x, y, th + 0.34 * size, 0.42 * size, 0.42 * size, 0.2 * size, 60, 0.065, 0.11, M.LEAF_OLIVE, 0.58);
  } else {
    const th = 1.0 * size;
    const lx = (r() - 0.5) * 0.3;
    const ly = (r() - 0.5) * 0.3;
    m.capsule(x, y, 0, x + lx, y + ly, th, 0.055 * size, 0.035 * size, M.BARK);
    for (let i = 0; i < 5; i++) {
      const a = r() * 6.28;
      m.capsule(x + lx, y + ly, th * 0.92, x + lx + Math.cos(a) * 0.3 * size, y + ly + Math.sin(a) * 0.3 * size, th + 0.12 * size, 0.028 * size, 0.012 * size, M.BARK);
    }
    crown(x + lx, y + ly, th + 0.18 * size, 0.5 * size, 0.5 * size, 0.1 * size, 44, 0.08, 0.13, M.LEAF_PINE, 0.45);
  }
}

function bush(m: Model, x: number, y: number, s: number, r: () => number, berries: boolean): void {
  for (let i = 0; i < 6; i++) {
    const px = x + (r() - 0.5) * 0.25 * s;
    const py = y + (r() - 0.5) * 0.25 * s;
    const pz = (0.08 + r() * 0.08) * s;
    const rad = (0.09 + r() * 0.06) * s;
    const R = m.res;
    m.sphere(px, py, pz, rad, rad, rad * 0.85, (lx, ly, lz) =>
      hash3(Math.floor(lx * R * 0.7), Math.floor(ly * R * 0.7), Math.floor(lz * R * 0.7)) < 0.25 && Math.hypot(lx - px, ly - py, (lz - pz) / 0.85) > rad * 0.75 ? 0 : M.LEAF_BUSH);
    if (berries) {
      for (let k = 0; k < 16; k++) {
        let u: number;
        let v: number;
        let w: number;
        do {
          u = r() * 2 - 1;
          v = r() * 2 - 1;
          w = r() * 2 - 1;
        } while (u * u + v * v + w * w > 1 || u * u + v * v + w * w < 0.3);
        const l = Math.hypot(u, v, w);
        if (w / l < -0.2) continue;
        m.sphere(px + (u / l) * rad, py + (v / l) * rad, pz + (w / l) * rad * 0.85, 0.02, 0.02, 0.02, M.BERRY);
      }
    }
  }
}

/** A heap of big faceted boulders with smaller ones stacked and scattered; gold has ore-bearing rock. */
function rockPile(m: Model, cx: number, cy: number, gold: boolean, r: () => number, n: number, spread: number): void {
  const stones: [number, number, number, boolean][] = [];
  for (let k = 0; k < n; k++) {
    const big = k < 4;
    const rad = big ? 0.36 + 0.12 * r() : 0.14 + 0.12 * r();
    const ang = r() * 6.28;
    const dd = big ? spread * (0.12 + 0.3 * r()) : spread * (0.25 + 0.35 * r());
    stones.push([cx + Math.cos(ang) * dd, cy + Math.sin(ang) * dd, rad, big]);
  }
  const mt = gold ? M.GOLDROCK : M.ROCK;
  for (const [bx, by, rad, big] of stones) {
    const dc = Math.hypot(bx - cx, by - cy) / spread;
    const bz = rad * 0.35 + Math.max(0, 0.34 - dc * 0.5) * (rad < 0.22 ? 1 : 0.5);
    const rx = rad * (1 + 0.35 * r());
    const ry = rad * (0.75 + 0.3 * r());
    const rz = rad * (big ? 1.25 + 0.6 * r() : 0.8 + 0.5 * r());
    const a = r() * 6.28;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const planes: [number, number, number, number][] = [];
    for (let p = 0; p < 12; p++) {
      const u = r() * 2 - 1;
      const v = r() * 2 - 1;
      const w = r() * 1.8 - 0.3;
      const l = Math.hypot(u, v, w);
      planes.push([u / l, v / l, w / l, 0.3 + 0.32 * r()]);
    }
    const sd = r() * 100;
    const ext = Math.max(rx, ry) * 1.1;
    m.op(bx - ext, by - ext, 0, bx + ext, by + ext, bz + rz * 1.1, (x, y, z) => {
      const dx = x - bx;
      const dy = y - by;
      const qx = (dx * ca + dy * sa) / rx;
      const qy = (-dx * sa + dy * ca) / ry;
      const qz = (z - bz) / rz;
      const e = qx * qx + qy * qy + qz * qz + (vn3(x * 14 + sd, y * 14, z * 14) - 0.5) * 0.12;
      if (e > 1) return 0;
      for (let i = 0; i < 12; i++) {
        const p = planes[i]!;
        if (qx * p[0] + qy * p[1] + qz * p[2] > p[3]) return 0;
      }
      return mt;
    }, 0);
  }
  if (gold) {
    for (let g = 0; g < 8; g++) {
      const ga = r() * 6.28;
      const d = spread * 0.45 * r();
      const gr = 0.022 + 0.022 * r();
      m.sphere(cx + Math.cos(ga) * d, cy + Math.sin(ga) * d, 0.05 + 0.3 * r(), gr, gr * 0.9, gr * 0.8, M.GOLD, 0);
    }
  }
  for (let k = 0; k < 16; k++) {
    const a = r() * 6.28;
    const d = spread * (0.5 + 0.4 * r());
    const rr = 0.025 + 0.045 * r();
    m.sphere(cx + Math.cos(a) * d, cy + Math.sin(a) * d, rr * 0.3, rr, rr * 0.85, rr * 0.65, gold && r() < 0.45 ? (r() < 0.3 ? M.GOLD : M.GOLDROCK) : M.ROCK);
  }
}

export const TREE_VARIANTS: readonly { kind: TreeKind; seed: number; size: number }[] = [
  { kind: 'oak', seed: 4, size: 1.05 },
  { kind: 'oak', seed: 17, size: 0.95 },
  { kind: 'cypress', seed: 6, size: 1.1 },
  { kind: 'olive', seed: 31, size: 1.0 },
  { kind: 'pine', seed: 12, size: 0.95 },
  { kind: 'oak', seed: 44, size: 1.12 },
  { kind: 'cypress', seed: 21, size: 0.95 },
  { kind: 'olive', seed: 9, size: 1.08 },
];

export function treeModel(v: number): Model {
  const t = TREE_VARIANTS[v % TREE_VARIANTS.length]!;
  const m = new Model(-0.85, -0.85, 1.7, 1.7, 2.3, 28);
  m.aoR = 6;
  m.faceW = 0.05;
  m.seed = t.seed * 13;
  addTree(m, 0.85, 0.85, t.kind, t.size, rng(t.seed));
  return m;
}

export function berryModel(v: number): Model {
  const m = new Model(-0.7, -0.7, 1.4, 1.4, 0.5, 32);
  m.faceW = 0.08;
  const r = rng(77 + v * 11);
  bush(m, 0.55, 0.6, 1.1, r, true);
  bush(m, 0.9, 0.78, 1.0, r, true);
  bush(m, 0.62, 0.95, 0.9, r, true);
  return m;
}

export function depositModel(gold: boolean, v: number): Model {
  const m = new Model(-1.3, -1.3, 2.6, 2.6, 1.25, 48);
  m.faceW = 0.6;
  rockPile(m, 1.3, 1.3, gold, rng((gold ? 11 : 23) + v * 101), gold ? 17 : 18, gold ? 1.2 : 1.25);
  return m;
}
