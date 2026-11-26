/**
 * Procedural materials: albedo (linear-ish 0..1 RGB before squaring), specular strength, shadow multiplier and a
 * weathering class, computed from the local position and normal of a surface point. All look tuning of stone,
 * timber, roofs, cloth and so on lives here.
 */

import { LIGHT } from './light';
import { clamp, fbm2, fbm3, fract, hash2, hash3, smooth, vn2, vn3 } from './noise';
import type { Model } from './voxel';

export const M = {
  ASHLAR: 2,
  RUBBLE: 3,
  BRICK: 4,
  BYZ: 5,
  PLASTER: 6,
  DAUB: 7,
  TIMBV: 8,
  TIMBH: 9,
  PLANK: 10,
  THATCH: 11,
  TILE: 12,
  SHINGLE: 13,
  LEAD: 14,
  DOOR: 15,
  DARK: 16,
  BLUE: 17,
  ROCK: 18,
  GOLDROCK: 19,
  BARK: 20,
  LOGEND: 21,
  LEAF_OAK: 22,
  LEAF_OLIVE: 23,
  LEAF_CYP: 24,
  LEAF_BUSH: 25,
  BERRY: 26,
  CROP: 27,
  CROP2: 28,
  SKIN: 29,
  HAIR: 30,
  LINEN: 31,
  WOOL: 32,
  OCHRE: 33,
  HOSE: 34,
  LEATHER: 35,
  METAL: 36,
  TOOLWOOD: 37,
  HORSE: 38,
  HORSEDK: 39,
  STRAW: 40,
  SACK: 41,
  GOLD: 42,
  OLDWOOD: 43,
  MARBLE: 44,
  BLUEPAINT: 45,
  LEAF_DRY: 46,
  PLASTER2: 47,
  REDCLOTH: 48,
  IRONDARK: 49,
  LEAF_PINE: 50,
  /** Team-coloured cloth and paint (the renderer stores a shade level; the manifest tints it per player). */
  DYE_RED: 51,
  DYE_YELLOW: 52,
  DYE_GREEN: 53,
  WATER: 54,
  ROPE: 55,
  EARTH: 56,
  CANVAS: 57,
  BRONZE: 58,
  HORSEGREY: 59,
  HORSEBLK: 60,
  ORE: 61,
  COAL: 62,
  FIRE: 63,
  HAY: 64,
  TARGET: 65,
  FURROW: 66,
  STONEDK: 67,
  GOLDTRIM: 68,
  SCALE: 69,
} as const;

/** Materials drawn in the player's colour. */
export function isTeam(mt: number): boolean {
  return mt === M.BLUE || mt === M.BLUEPAINT;
}

/** Output of `material()` / `terrain()`: albedo, specular, shadow multiplier, weathering class. */
export const out = { r: 0, g: 0, b: 0, spec: 0, wc: 0, shm: 1 };

function setc(r: number, g: number, b: number): void {
  out.r = r;
  out.g = g;
  out.b = b;
}
function mixc(r: number, g: number, b: number, t: number): void {
  out.r += (r - out.r) * t;
  out.g += (g - out.g) * t;
  out.b += (b - out.b) * t;
}
function mulc(k: number): void {
  out.r *= k;
  out.g *= k;
  out.b *= k;
}

let VD1 = 0;
let VD2 = 0;
let VID = 0;
function voronoi(u: number, v: number): void {
  const ui = Math.floor(u);
  const vi = Math.floor(v);
  let d1 = 9;
  let d2 = 9;
  let id = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = ui + i;
      const cy = vi + j;
      const px = cx + 0.15 + 0.7 * hash2(cx, cy);
      const py = cy + 0.15 + 0.7 * hash3(cx, cy, 7);
      const dx = px - u;
      const dy = py - v;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        id = cx * 7919 + cy * 104729;
      } else if (d < d2) d2 = d;
    }
  }
  VD1 = d1;
  VD2 = d2;
  VID = id;
}

function rubble(u: number, v: number, scale: number, warm: boolean): void {
  voronoi(u * 6.5 * scale, v * 9.5 * scale);
  const e = VD2 - VD1;
  const h = hash2(VID, 3);
  const h2 = hash2(VID, 9);
  if (e < 0.11 + 0.06 * vn2(u * 50, v * 50)) {
    setc(0.3, 0.27, 0.22);
    mulc(0.8 + 0.3 * vn2(u * 90, v * 90));
    out.shm = 0.75;
    return;
  }
  if (h < 0.3) setc(0.56, 0.53, 0.48);
  else if (h < 0.55) setc(0.62, 0.55, 0.43);
  else if (h < 0.75) setc(0.5, 0.46, 0.41);
  else if (h < 0.9) setc(0.66, 0.6, 0.5);
  else setc(0.55, 0.45, 0.36);
  if (warm) mixc(0.68, 0.56, 0.4, 0.35);
  const bulge = smooth(0.08, 0.45, e);
  mulc((0.78 + 0.3 * bulge) * (0.85 + 0.25 * vn2(u * 70, v * 70)) * (0.92 + 0.12 * h2));
}

function ashlar(u: number, v: number, top: boolean, lx: number, ly: number): void {
  if (top) {
    u = lx;
    v = ly;
  }
  const h = 0.078;
  const row = Math.floor(v / h);
  const fv = v / h - row;
  const Lw = 0.13 + 0.12 * hash2(row, 11);
  const off = hash2(row, 5) * Lw;
  const uu = u + off;
  const col = Math.floor(uu / Lw);
  const fu = uu / Lw - col;
  const id = hash2(col * 31 + 7, row * 17 + 3);
  const mort = Math.min(fv * h, (1 - fv) * h, fu * Lw, (1 - fu) * Lw);
  const thr = 0.009 + 0.008 * vn2(u * 60, v * 60);
  if (mort < thr) {
    setc(0.4, 0.36, 0.3);
    out.shm = 0.7;
    return;
  }
  if (id < 0.35) setc(0.74, 0.68, 0.56);
  else if (id < 0.6) setc(0.68, 0.61, 0.49);
  else if (id < 0.8) setc(0.79, 0.73, 0.61);
  else if (id < 0.92) setc(0.7, 0.62, 0.53);
  else setc(0.62, 0.58, 0.52);
  mulc(0.86 + 0.2 * vn2(u * 55 + id * 9, v * 55) + 0.08 * (hash2(Math.floor(u * 140), Math.floor(v * 140)) - 0.5));
  if (!top) mulc(smooth(0, 0.35, fv) * 0.25 + 0.88 - 0.1 * smooth(0.6, 1, fu));
}

function brick(u: number, v: number): void {
  const h = 0.052;
  const row = Math.floor(v / h);
  const fv = v / h - row;
  const Lw = 0.1;
  const off = (row & 1) * 0.5 * Lw + hash2(row, 2) * 0.02;
  const uu = u + off;
  const col = Math.floor(uu / Lw);
  const fu = uu / Lw - col;
  if (fv < 0.42 || fu < 0.06) {
    setc(0.66, 0.61, 0.52);
    mulc(0.85 + 0.2 * vn2(u * 80, v * 80));
    out.shm = 0.85;
    return;
  }
  const id = hash2(col * 13 + 1, row * 7 + 5);
  if (id < 0.4) setc(0.6, 0.34, 0.22);
  else if (id < 0.7) setc(0.66, 0.42, 0.28);
  else if (id < 0.9) setc(0.5, 0.29, 0.2);
  else setc(0.72, 0.5, 0.36);
  mulc(0.85 + 0.25 * vn2(u * 90, v * 90));
}

/** Weathering: rising ground dirt, streaks, rain stains, mottling and moss, scaled by LIGHT.grit. */
function weather(lx: number, ly: number, lz: number, u: number, wall: boolean, nz: number, cls: number, mt: number): void {
  const g = LIGHT.grit;
  const fd = Math.exp(-lz / (0.09 + 0.1 * g)) * (0.5 + 0.5 * vn2(u * 7 + 3, lz * 3));
  mixc(0.36, 0.29, 0.21, clamp(fd * (0.55 + 0.35 * g), 0, 0.85));
  if (wall) {
    const st = vn2(u * 26 + lx * 0.3, lz * 1.6 + ly);
    mulc(1 - (0.1 + 0.16 * g) * smooth(0.45, 0.9, st));
    const st2 = fbm2(u * 9, lz * 2.2, 2);
    mixc(0.3, 0.28, 0.24, smooth(0.6, 0.85, st2) * (0.2 + 0.25 * g));
  }
  const mot = fbm2(u * 5 + lx, lz * 5 + ly, 2);
  mulc(1 - (0.1 + 0.12 * g) * (mot - 0.5) * 2);
  if (cls === 3 && nz > 0.25 && mt !== M.THATCH) {
    const moss = smooth(0.58, 0.78, fbm2(lx * 6 + 4, ly * 6 + lz * 4, 3)) * (0.35 + 0.5 * g);
    mixc(0.33, 0.35, 0.2, moss);
  }
}

function cloth(r: number, g: number, b: number, lx: number, ly: number, lz: number): void {
  setc(r, g, b);
  mulc(0.82 + 0.25 * vn2(lx * 140, lz * 140 + ly * 140));
  mixc(0.3, 0.3, 0.3, 0.12 * LIGHT.grit);
}

/** Rock with optional gold ore. Large faceted masses, cracks, lichen; gold shows as veins and glinting nuggets. */
function rock(mt: number, x: number, y: number, z: number, nz: number): void {
  const gold = mt === M.GOLDROCK;
  if (gold) setc(0.22, 0.2, 0.18);
  else setc(0.44, 0.43, 0.4);
  mixc(gold ? 0.34 : 0.56, gold ? 0.3 : 0.5, gold ? 0.26 : 0.42, smooth(0.5, 0.75, vn3(x * 2.5 + 9, y * 2.5, z * 2.5)) * 0.5);
  const b = fbm3(x * 3, y * 3, z * 3, 3);
  mixc(gold ? 0.2 : 0.42, gold ? 0.19 : 0.4, gold ? 0.18 : 0.37, smooth(0.35, 0.7, b) * 0.6);
  if (!gold) mixc(0.72, 0.68, 0.6, smooth(0.6, 0.8, vn3(x * 7, y * 7, z * 7)) * 0.45);
  // Strata bands on stone.
  if (!gold) mulc(0.9 + 0.12 * Math.sin((z * 9 + vn3(x * 3, y * 3, 0) * 3) * 3.1));
  mulc(0.84 + 0.22 * vn3(x * 50, y * 50, z * 50) + 0.08 * (hash3(Math.floor(x * 150), Math.floor(y * 150), Math.floor(z * 150)) - 0.5));
  const cr = Math.abs(vn3(x * 9, y * 9, z * 9) - 0.5);
  if (cr < (gold ? 0.028 : 0.04)) mulc(gold ? 0.5 : 0.42);
  const cr2 = Math.abs(vn3(x * 21 + 4, y * 21, z * 21) - 0.5);
  if (cr2 < 0.02) mulc(0.65);
  const li = vn3(x * 12 + 5, y * 12, z * 12);
  if (li > 0.8 && nz > 0.2) mixc(0.6, 0.6, 0.4, 0.5);
  if (gold) {
    const ore = fbm3(x * 4.5 + 2, y * 4.5, z * 4.5, 3);
    const vein = Math.abs(fbm3(x * 5 + 9, y * 5, z * 5, 2) - 0.5);
    const vein2 = Math.abs(vn3(x * 11 + 3, y * 11, z * 11) - 0.5);
    const nug = hash3(Math.floor(x * 46), Math.floor(y * 46), Math.floor(z * 46));
    if (ore > 0.68 || vein < 0.016 || vein2 < 0.012 || nug > 0.992) {
      setc(0.86, 0.62, 0.2);
      mulc(0.6 + 0.55 * vn3(x * 70, y * 70, z * 70));
      if (hash3(Math.floor(x * 110), Math.floor(y * 110), Math.floor(z * 110)) > 0.82) setc(1.0, 0.86, 0.5);
      out.spec = 0.9;
    } else if (ore > 0.62 || vein < 0.03) mixc(0.45, 0.34, 0.16, 0.45);
  }
}

/**
 * Shade a surface point. (lx, ly, lz): position relative to the model origin (z absolute), (nx, ny, nz): normal.
 */
export function material(mt: number, lx: number, ly: number, lz: number, nx: number, ny: number, nz: number, m: Model): void {
  out.spec = 0;
  out.wc = 0;
  out.shm = 1;
  const anx = Math.abs(nx);
  const any = Math.abs(ny);
  const u = anx > any ? ly : lx;
  const top = nz > 0.7;
  const wall = Math.abs(nz) < 0.55;
  const grit = LIGHT.grit;
  switch (mt) {
    case M.ASHLAR:
      ashlar(u, lz, top, lx, ly);
      out.wc = 1;
      break;
    case M.RUBBLE:
      rubble(u + (top ? ly : 0), top ? lx : lz, 1, false);
      out.wc = 1;
      break;
    case M.BRICK:
      brick(u, lz);
      out.wc = 1;
      break;
    case M.BYZ: {
      const ph = fract((lz + 0.04) / 0.36);
      if (ph < 0.33 && !top) brick(u, lz);
      else ashlar(u, lz, top, lx, ly);
      out.wc = 1;
      break;
    }
    case M.STONEDK:
      rubble(u + (top ? ly : 0), top ? lx : lz, 1.4, false);
      mulc(0.72);
      out.wc = 1;
      break;
    case M.PLASTER:
    case M.PLASTER2: {
      const p = fbm2(u * 3.3 + lx * 0.2, lz * 3.3 + 7, 3);
      if (!top && p > 0.64 + 0.03 * (1 - grit)) {
        rubble(u, lz, 1.2, true);
        if (p < 0.665) mulc(0.6);
        out.wc = 1;
        break;
      }
      if (mt === M.PLASTER) setc(0.82, 0.76, 0.64);
      else setc(0.78, 0.66, 0.5);
      mixc(0.62, 0.53, 0.4, smooth(0.4, 0.8, fbm2(u * 2.2 + 11, lz * 2.2, 3)) * 0.55);
      mulc(0.9 + 0.14 * vn2(u * 40, lz * 40) + 0.06 * (hash2(Math.floor(u * 160), Math.floor(lz * 160)) - 0.5));
      if (Math.abs(vn2(u * 9 + 3, lz * 9) - 0.5) < 0.012 + 0.008 * grit) mulc(0.62);
      out.wc = 1;
      break;
    }
    case M.DAUB: {
      setc(0.6, 0.5, 0.36);
      mixc(0.48, 0.4, 0.3, smooth(0.35, 0.75, fbm2(u * 4, lz * 4, 3)) * 0.7);
      mulc(0.82 + 0.3 * vn2(u * 45, lz * 45));
      if (hash2(Math.floor(u * 120), Math.floor(lz * 300)) > 0.93) mixc(0.75, 0.66, 0.42, 0.6);
      if (Math.abs(vn2(u * 11, lz * 11) - 0.5) < 0.015) mulc(0.6);
      out.wc = 1;
      break;
    }
    case M.TIMBV:
    case M.TIMBH:
    case M.OLDWOOD: {
      const gu = mt === M.TIMBH ? lz : u + (top ? ly : 0);
      const gv = mt === M.TIMBH ? u : lz;
      if (mt === M.OLDWOOD) setc(0.52, 0.47, 0.4);
      else setc(0.36, 0.27, 0.18);
      const gr = vn2(gu * 70, gv * 6);
      const gr2 = vn2(gu * 160, gv * 14);
      mulc(0.72 + 0.35 * gr + 0.15 * gr2);
      if (gr2 < 0.12) mulc(0.6);
      out.wc = 2;
      break;
    }
    case M.PLANK:
    case M.DOOR: {
      const pw = 0.055;
      const pi = Math.floor(u / pw);
      const f = u / pw - pi;
      const h = hash2(pi, 41);
      if (mt === M.DOOR) setc(0.33, 0.23, 0.15);
      else setc(0.47, 0.38, 0.27);
      mulc(0.82 + 0.3 * h);
      mulc(0.75 + 0.35 * vn2(u * 120, lz * 9 + pi * 3));
      if (f < 0.1) {
        mulc(0.45);
        out.shm = 0.8;
      }
      out.wc = 2;
      break;
    }
    case M.THATCH: {
      setc(0.55, 0.46, 0.31);
      mixc(0.42, 0.38, 0.31, smooth(0.35, 0.75, fbm2(lx * 2.5, ly * 2.5 + lz, 3)) * 0.75);
      mixc(0.3, 0.26, 0.2, smooth(0.6, 0.85, fbm2(lx * 6 + 3, ly * 6, 2)) * 0.5);
      const fr = fract(lz / 0.06 + 0.35 * vn2(u * 8, lz * 3));
      const str = vn2(u * 140, lz * 18) * 0.5 + vn2(u * 300, lz * 34) * 0.5;
      mulc((0.6 + 0.6 * str) * (0.84 + 0.16 * smooth(0, 0.5, fr)));
      if (str < 0.22) mulc(0.6);
      else if (str > 0.8) mixc(0.68, 0.6, 0.42, 0.35);
      out.wc = 3;
      break;
    }
    case M.TILE: {
      const cw = 0.052;
      const ci = Math.floor(u / cw);
      const pu = u / cw - ci;
      const rv = lz / 0.042 + hash2(ci, 77) * 0.12 + (vn2(u * 3, lz * 3) - 0.5) * 0.3;
      const ri = Math.floor(rv);
      const fr = rv - ri;
      const h = hash2(ci * 3 + 1, ri * 5 + 2);
      if (h < 0.45) setc(0.6, 0.36, 0.24);
      else if (h < 0.7) setc(0.66, 0.42, 0.29);
      else if (h < 0.88) setc(0.52, 0.31, 0.22);
      else if (h < 0.97) setc(0.6, 0.44, 0.33);
      else setc(0.46, 0.41, 0.34);
      mixc(0.48, 0.36, 0.28, smooth(0.35, 0.8, fbm2(lx * 3, ly * 3 + lz * 3, 2)) * 0.6);
      mixc(0.72, 0.55, 0.4, smooth(0.65, 0.85, fbm2(lx * 2 + 5, ly * 2 + lz * 2, 2)) * 0.4);
      const crest = Math.sin(pu * Math.PI);
      out.shm = 0.55 + 0.6 * crest;
      mulc((0.78 + 0.28 * smooth(0, 0.7, fr)) * (0.88 + 0.2 * vn2(u * 90, lz * 90)));
      if (pu < 0.1 || pu > 0.93) mulc(0.55);
      if (hash2(ci * 7 + 3, ri * 11) > 0.985) {
        setc(0.2, 0.17, 0.14);
        out.shm = 0.5;
      }
      out.spec = 0.06;
      out.wc = 3;
      break;
    }
    case M.SHINGLE: {
      const ri = Math.floor(lz / 0.038);
      const fr = lz / 0.038 - ri;
      const w = 0.035 + 0.02 * hash2(ri, 3);
      const uu = u + hash2(ri, 9) * 0.1;
      const ci = Math.floor(uu / w);
      const fu = uu / w - ci;
      setc(0.46, 0.4, 0.33);
      mulc(0.75 + 0.35 * hash2(ci, ri * 13));
      mixc(0.38, 0.38, 0.34, smooth(0.4, 0.8, fbm2(lx * 4, ly * 4, 2)) * 0.5);
      mulc((0.7 + 0.35 * smooth(0, 0.8, fr)) * (0.85 + 0.25 * vn2(uu * 120, lz * 30)));
      if (fu < 0.08) mulc(0.55);
      out.wc = 3;
      break;
    }
    case M.LEAD: {
      const dc = m.domeC ?? [0, 0];
      const ang = Math.atan2(ly - dc[1], lx - dc[0]);
      const rib = fract((ang / (Math.PI * 2)) * 16);
      setc(0.41, 0.43, 0.44);
      mixc(0.56, 0.59, 0.56, smooth(0.5, 0.9, vn2(ang * 18, lz * 0.7)) * 0.45);
      mixc(0.27, 0.28, 0.27, smooth(0.6, 0.9, vn2(ang * 9 + 4, lz * 2.5)) * 0.4);
      if (rib < 0.07) mulc(0.7);
      else if (rib < 0.14) mulc(1.12);
      out.spec = 0.15;
      out.wc = 3;
      break;
    }
    case M.DARK:
      setc(0.07, 0.06, 0.05);
      break;
    case M.BLUE:
      // Team cloth: a neutral mid-blue; the manifest re-tints these pixels by shade level.
      cloth(0.2, 0.32, 0.62, lx, ly, lz);
      break;
    case M.BLUEPAINT:
      cloth(0.24, 0.37, 0.68, lx, ly, lz);
      break;
    case M.REDCLOTH:
      cloth(0.55, 0.2, 0.14, lx, ly, lz);
      break;
    case M.DYE_RED:
      cloth(0.62, 0.16, 0.12, lx, ly, lz);
      break;
    case M.DYE_YELLOW:
      cloth(0.8, 0.6, 0.18, lx, ly, lz);
      break;
    case M.DYE_GREEN:
      cloth(0.28, 0.42, 0.22, lx, ly, lz);
      break;
    case M.CANVAS:
      setc(0.7, 0.65, 0.54);
      mulc(0.82 + 0.22 * vn2(lx * 90 + lz * 30, ly * 90));
      mixc(0.45, 0.4, 0.32, smooth(0.55, 0.85, fbm2(lx * 5, ly * 5 + lz * 5, 2)) * 0.5);
      break;
    case M.ROCK:
    case M.GOLDROCK:
      rock(mt, lx, ly, lz, nz);
      break;
    case M.ORE:
      rock(M.GOLDROCK, lx * 2, ly * 2, lz * 2, nz);
      break;
    case M.COAL:
      setc(0.12, 0.11, 0.1);
      mulc(0.8 + 0.4 * hash3(Math.floor(lx * 90), Math.floor(ly * 90), Math.floor(lz * 90)));
      break;
    case M.GOLD:
      setc(0.9, 0.68, 0.26);
      mulc(0.75 + 0.35 * vn3(lx * 90, ly * 90, lz * 90));
      out.spec = 0.8;
      break;
    case M.GOLDTRIM:
      setc(0.78, 0.6, 0.26);
      mulc(0.85 + 0.2 * vn3(lx * 90, ly * 90, lz * 90));
      out.spec = 0.6;
      break;
    case M.BRONZE:
      setc(0.62, 0.42, 0.22);
      mixc(0.32, 0.5, 0.4, smooth(0.6, 0.85, vn3(lx * 30, ly * 30, lz * 30)) * 0.4);
      out.spec = 0.6;
      break;
    case M.FIRE:
      setc(1.4, 0.7, 0.2);
      out.spec = 0;
      out.shm = 0;
      break;
    case M.BARK:
      setc(0.33, 0.27, 0.21);
      mulc(0.65 + 0.45 * vn2(u * 90, lz * 12) + 0.15 * vn2(u * 200, lz * 40));
      break;
    case M.LOGEND:
      setc(0.7, 0.56, 0.38);
      mulc(0.8 + 0.3 * vn2(lx * 100, ly * 100 + lz * 100));
      break;
    case M.LEAF_OAK:
    case M.LEAF_OLIVE:
    case M.LEAF_CYP:
    case M.LEAF_BUSH:
    case M.LEAF_DRY:
    case M.LEAF_PINE: {
      const big = vn3(lx * 5 + m.seed, ly * 5, lz * 5);
      const lf = hash3(Math.floor(lx * 90), Math.floor(ly * 90), Math.floor(lz * 90));
      if (mt === M.LEAF_OAK) {
        setc(0.22, 0.3, 0.11);
        mixc(0.36, 0.4, 0.15, big * 0.7);
      } else if (mt === M.LEAF_OLIVE) {
        setc(0.3, 0.34, 0.22);
        mixc(0.42, 0.45, 0.33, big * 0.6);
      } else if (mt === M.LEAF_CYP) {
        setc(0.17, 0.25, 0.13);
        mixc(0.25, 0.32, 0.15, big * 0.6);
      } else if (mt === M.LEAF_PINE) {
        setc(0.18, 0.28, 0.16);
        mixc(0.28, 0.36, 0.2, big * 0.6);
      } else if (mt === M.LEAF_DRY) {
        setc(0.45, 0.43, 0.2);
        mixc(0.55, 0.48, 0.22, big * 0.7);
      } else {
        setc(0.24, 0.33, 0.15);
        mixc(0.33, 0.4, 0.18, big * 0.6);
      }
      mulc(0.55 + 0.7 * lf);
      if (lf > 0.95) mixc(0.6, 0.6, 0.34, 0.45);
      else if (lf < 0.1) mulc(0.6);
      break;
    }
    case M.BERRY:
      setc(0.6, 0.1, 0.16);
      if (hash3(Math.floor(lx * 100), Math.floor(ly * 100), Math.floor(lz * 100)) > 0.6) setc(0.36, 0.07, 0.22);
      out.spec = 0.35;
      break;
    case M.CROP:
      setc(0.33, 0.39, 0.15);
      mulc(0.55 + 0.6 * hash3(Math.floor(lx * 80), Math.floor(ly * 80), Math.floor(lz * 80)));
      break;
    case M.CROP2:
      setc(0.66, 0.54, 0.24);
      mulc(0.55 + 0.6 * hash3(Math.floor(lx * 80), Math.floor(ly * 80), Math.floor(lz * 80)));
      break;
    case M.FURROW: {
      setc(0.4, 0.3, 0.21);
      mulc(0.82 + 0.3 * vn2(lx * 60, ly * 60));
      if (hash2(Math.floor(lx * 50), Math.floor(ly * 50)) > 0.9) mixc(0.55, 0.47, 0.34, 0.5);
      out.wc = 0;
      break;
    }
    case M.EARTH:
      setc(0.42, 0.35, 0.26);
      mixc(0.52, 0.46, 0.36, smooth(0.45, 0.75, vn2(lx * 9, ly * 9)) * 0.6);
      mulc(0.8 + 0.3 * vn2(lx * 70 + lz * 30, ly * 70));
      break;
    case M.WATER:
      setc(0.16, 0.2, 0.2);
      mixc(0.3, 0.36, 0.34, vn2(lx * 30, ly * 30) * 0.4);
      out.spec = 0.9;
      break;
    case M.ROPE:
      setc(0.6, 0.5, 0.33);
      mulc(0.8 + 0.3 * vn3(lx * 160, ly * 160, lz * 160));
      break;
    case M.SKIN:
      setc(0.7, 0.5, 0.36);
      break;
    case M.HAIR:
      setc(0.2, 0.14, 0.09);
      break;
    case M.LINEN:
      setc(0.66, 0.6, 0.48);
      mulc(0.85 + 0.2 * vn2(lx * 200, lz * 200));
      break;
    case M.WOOL:
      setc(0.44, 0.34, 0.24);
      mulc(0.85 + 0.2 * vn2(lx * 200, lz * 200));
      break;
    case M.OCHRE:
      setc(0.58, 0.46, 0.26);
      mulc(0.85 + 0.2 * vn2(lx * 200, lz * 200));
      break;
    case M.HOSE:
      setc(0.3, 0.27, 0.22);
      break;
    case M.LEATHER:
      setc(0.36, 0.24, 0.15);
      break;
    case M.METAL:
      setc(0.58, 0.59, 0.6);
      mulc(0.8 + 0.3 * vn3(lx * 150, ly * 150, lz * 150));
      out.spec = 0.7;
      break;
    case M.SCALE: {
      const row = Math.floor(lz * 90);
      const col = Math.floor((lx + ly) * 90 + (row & 1) * 0.5);
      setc(0.5, 0.5, 0.5);
      mulc(0.7 + 0.45 * hash2(col, row));
      out.spec = 0.6;
      break;
    }
    case M.IRONDARK:
      setc(0.3, 0.3, 0.31);
      out.spec = 0.4;
      break;
    case M.TOOLWOOD:
      setc(0.5, 0.38, 0.24);
      break;
    case M.HORSE:
      setc(0.44, 0.27, 0.16);
      mulc(0.9 + 0.12 * vn3(lx * 60, ly * 60, lz * 60));
      out.spec = 0.12;
      break;
    case M.HORSEGREY:
      setc(0.62, 0.6, 0.56);
      mulc(0.88 + 0.14 * vn3(lx * 60, ly * 60, lz * 60));
      out.spec = 0.1;
      break;
    case M.HORSEBLK:
      setc(0.17, 0.13, 0.11);
      mulc(0.9 + 0.12 * vn3(lx * 60, ly * 60, lz * 60));
      out.spec = 0.15;
      break;
    case M.HORSEDK:
      setc(0.14, 0.1, 0.08);
      break;
    case M.STRAW:
    case M.HAY:
      setc(0.74, 0.63, 0.38);
      if (mt === M.HAY) mixc(0.6, 0.6, 0.3, 0.25);
      mulc(0.7 + 0.45 * vn2(lx * 150 + lz * 40, ly * 150));
      break;
    case M.SACK:
      setc(0.62, 0.54, 0.4);
      mulc(0.85 + 0.2 * vn3(lx * 120, ly * 120, lz * 120));
      out.wc = 2;
      break;
    case M.MARBLE:
      setc(0.82, 0.79, 0.72);
      mulc(0.9 + 0.1 * vn2(lx * 30 + lz * 20, ly * 30));
      out.wc = 1;
      break;
    case M.TARGET:
      setc(0.74, 0.63, 0.38);
      mulc(0.75 + 0.35 * vn2(lx * 150, lz * 150 + ly * 150));
      break;
    default:
      setc(1, 0, 1);
  }
  if (out.wc) weather(lx, ly, lz, u, wall, nz, out.wc, mt);
}
