/**
 * Ray casting through voxel models: primary (view) rays and shadow/occlusion rays. Both march only inside the
 * model's box of visible voxels (Model.bx0..bz1, from finalize), which skips the empty margins of the grid.
 */

import { K } from './project';
import { PAD, type Model } from './voxel';

/** Result of the last successful castPrimary: ray parameter, hit face axis (0 x, 1 y, 2 z), material. */
export const hit = { t: 0, axis: 0, mat: 0 };

/**
 * March the view ray through ground point (wx0, wy0) from the camera side (large t) down to `tmin`. Returns true on
 * a visible voxel nearer the camera than `tmin`, filling `hit`.
 */
export function castPrimary(m: Model, wx0: number, wy0: number, tmin: number): boolean {
  if (m.bx1 < m.bx0) return false;
  const R = m.res;
  const { nx, ny, mat } = m;
  const bx0 = m.bx0;
  const by0 = m.by0;
  // Box faces in world units.
  const X0 = m.ox + bx0 / R;
  const Y0 = m.oy + by0 / R;
  const X1 = m.ox + (m.bx1 + 1) / R;
  const Y1 = m.oy + (m.by1 + 1) / R;
  const Z1 = m.oz + (m.bz1 + 1) / R;
  const Z0 = m.oz + PAD / R;
  const tx = X1 - wx0;
  const ty = Y1 - wy0;
  const tz = Z1 / K;
  const t1 = Math.min(tx, ty, tz);
  const t0 = Math.max(X0 - wx0, Y0 - wy0, Z0 / K, tmin);
  if (t1 <= t0) return false;
  let axis = t1 === tx ? 0 : t1 === ty ? 1 : 2;
  const px = (wx0 + t1 - m.ox) * R;
  const py = (wy0 + t1 - m.oy) * R;
  const pz = (K * t1 - m.oz) * R;
  let ix = Math.min(Math.floor(px - 1e-6), m.bx1);
  let iy = Math.min(Math.floor(py - 1e-6), m.by1);
  let iz = Math.min(Math.floor(pz - 1e-6), m.bz1);
  const dX = 1 / R;
  const dZ = 1 / (R * K);
  let nX = (px - ix) / R;
  let nY = (py - iy) / R;
  let nZ = (pz - iz) / (R * K);
  const sEnd = t1 - t0;
  let s = 0;
  for (;;) {
    if (ix < bx0 || iy < by0 || iz < PAD) return false;
    const v = mat[ix + nx * (iy + ny * iz)]!;
    if (v > 1) {
      hit.t = t1 - s;
      hit.axis = axis;
      hit.mat = v;
      return true;
    }
    if (nX <= nY && nX <= nZ) {
      s = nX;
      ix--;
      nX += dX;
      axis = 0;
    } else if (nY <= nZ) {
      s = nY;
      iy--;
      nY += dX;
      axis = 1;
    } else {
      s = nZ;
      iz--;
      nZ += dZ;
      axis = 2;
    }
    if (s > sEnd) return false;
  }
}

/** True when the ray from world point (wx, wy, wz) along (dx, dy, dz) (dz > 0) hits a visible voxel of `m`. */
export function occluded(m: Model, wx: number, wy: number, wz: number, dx: number, dy: number, dz: number): boolean {
  if (m.bx1 < m.bx0) return false;
  const R = m.res;
  const { nx, ny, mat } = m;
  const bx0 = m.bx0;
  const by0 = m.by0;
  const bx1 = m.bx1 + 1;
  const by1 = m.by1 + 1;
  const bz1 = m.bz1 + 1;
  let px = (wx - m.ox) * R;
  let py = (wy - m.oy) * R;
  let pz = (wz - m.oz) * R;
  let s0 = 0;
  let s1 = 1e9;
  if (dx !== 0) {
    let a = (bx0 - px) / dx;
    let b = (bx1 - px) / dx;
    if (a > b) {
      const q = a;
      a = b;
      b = q;
    }
    if (a > s0) s0 = a;
    if (b < s1) s1 = b;
  } else if (px < bx0 || px >= bx1) return false;
  if (dy !== 0) {
    let a = (by0 - py) / dy;
    let b = (by1 - py) / dy;
    if (a > b) {
      const q = a;
      a = b;
      b = q;
    }
    if (a > s0) s0 = a;
    if (b < s1) s1 = b;
  } else if (py < by0 || py >= by1) return false;
  {
    let a = (PAD - pz) / dz;
    let b = (bz1 - pz) / dz;
    if (a > b) {
      const q = a;
      a = b;
      b = q;
    }
    if (a > s0) s0 = a;
    if (b < s1) s1 = b;
  }
  if (s1 <= s0) return false;
  s0 += 1e-5;
  px += dx * s0;
  py += dy * s0;
  pz += dz * s0;
  let ix = Math.floor(px);
  let iy = Math.floor(py);
  let iz = Math.floor(pz);
  if (ix < bx0) ix = bx0;
  if (ix >= bx1) ix = bx1 - 1;
  if (iy < by0) iy = by0;
  if (iy >= by1) iy = by1 - 1;
  if (iz < PAD) iz = PAD;
  if (iz >= bz1) iz = bz1 - 1;
  const sx = dx > 0 ? 1 : -1;
  const sy = dy > 0 ? 1 : -1;
  const sz = dz > 0 ? 1 : -1;
  const tdx = dx !== 0 ? Math.abs(1 / dx) : 1e9;
  const tdy = dy !== 0 ? Math.abs(1 / dy) : 1e9;
  const tdz = Math.abs(1 / dz);
  let tmx = dx > 0 ? (ix + 1 - px) / dx : dx < 0 ? (px - ix) / -dx : 1e9;
  let tmy = dy > 0 ? (iy + 1 - py) / dy : dy < 0 ? (py - iy) / -dy : 1e9;
  let tmz = dz > 0 ? (iz + 1 - pz) / dz : (pz - iz) / -dz;
  const len = s1 - s0;
  const nxny = nx * ny;
  for (;;) {
    if (mat[ix + nx * iy + nxny * iz]! > 1) return true;
    if (tmx < tmy && tmx < tmz) {
      if (tmx > len) return false;
      ix += sx;
      if (ix < bx0 || ix >= bx1) return false;
      tmx += tdx;
    } else if (tmy < tmz) {
      if (tmy > len) return false;
      iy += sy;
      if (iy < by0 || iy >= by1) return false;
      tmy += tdy;
    } else {
      if (tmz > len) return false;
      iz += sz;
      if (iz < PAD || iz >= bz1) return false;
      tmz += tdz;
    }
  }
}
