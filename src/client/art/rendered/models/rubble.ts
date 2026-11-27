/**
 * Rubble of a destroyed building (PLAN-M2 3.8 `rubble.2|3|4`, WP27): a heap of broken walling over the whole
 * footprint, highest in the middle, with stubs of wall still standing at some corners, charred beams lying across it
 * at all angles (some propped up on the heap) and loose dressed blocks spilt around its foot. Soot-blackened in
 * patches. Two variants per footprint, seeded. No trench or clean floor: that would read as a foundation.
 */

import { M } from '../materials';
import { rng } from '../noise';
import type { Model } from '../voxel';
import { blockPile, buildingModel } from './kit';

/** Height of the rubble model grid (tiles): enough for the wall stubs and propped beams. */
export const RUBBLE_HEIGHT = 0.6;

export function rubbleModel(fp: number, v: number): Model {
  const m = buildingModel(fp, RUBBLE_HEIGHT);
  const r = rng(9100 + fp * 37 + v * 1009);
  const c = fp / 2;
  // Trampled, scorched earth a little beyond the footprint.
  m.box(-0.2, -0.2, 0, fp + 0.2, fp + 0.2, 0.02, M.EARTH);
  // The heap: many overlapping flattened mounds of rubble walling and darker stone, highest towards the middle.
  const mounds = 6 + fp * fp * 2;
  for (let k = 0; k < mounds; k++) {
    const x = 0.2 + r() * (fp - 0.4);
    const y = 0.2 + r() * (fp - 0.4);
    const centre = 1 - Math.min(1, Math.hypot(x - c, y - c) / (c * 1.15));
    const rad = 0.3 + r() * 0.3;
    m.sphere(x, y, 0, rad, rad * (0.75 + 0.5 * r()), 0.09 + 0.2 * centre + 0.06 * r(), r() < 0.3 ? M.STONEDK : M.RUBBLE);
  }
  // Broken blocks lying on the heap.
  const chunks = 6 + fp * 5;
  for (let k = 0; k < chunks; k++) {
    const x = 0.25 + r() * (fp - 0.5);
    const y = 0.25 + r() * (fp - 0.5);
    const centre = 1 - Math.min(1, Math.hypot(x - c, y - c) / (c * 1.15));
    const s = 0.06 + r() * 0.07;
    const z = 0.06 + 0.2 * centre;
    m.box(x, y, z, x + s * (1 + r()), y + s, z + s * 0.8, r() < 0.5 ? M.ASHLAR : M.STONEDK);
  }
  // Wall stubs left standing at some corners.
  const corners: [number, number][] = [
    [0.1, 0.1],
    [fp - 0.45, 0.1],
    [0.1, fp - 0.45],
    [fp - 0.45, fp - 0.45],
  ];
  for (const [x, y] of corners) {
    if (r() < 0.45) continue;
    const h = 0.18 + r() * 0.3;
    const len = 0.3 + r() * 0.3;
    if (r() < 0.5) m.box(x, y, 0, x + len, y + 0.15, h * (0.6 + 0.4 * r()), M.RUBBLE);
    else m.box(x, y, 0, x + 0.15, y + len, h * (0.6 + 0.4 * r()), M.RUBBLE);
    m.box(x, y, 0, x + 0.17, y + 0.17, h + 0.05, M.ASHLAR);
  }
  // Charred beams at all angles, some with one end propped up on the heap.
  const beams = 3 + fp * 2;
  for (let k = 0; k < beams; k++) {
    const a = r() * Math.PI;
    const len = 0.5 + r() * (fp * 0.35);
    const x = 0.4 + r() * (fp - 0.8);
    const y = 0.4 + r() * (fp - 0.8);
    const dx = Math.cos(a) * len * 0.5;
    const dy = Math.sin(a) * len * 0.5;
    const z0 = 0.06 + r() * 0.08;
    const z1 = r() < 0.4 ? z0 + 0.12 + r() * 0.18 : z0 + r() * 0.05;
    const w = 0.03 + r() * 0.015;
    m.capsule(x - dx, y - dy, z0, x + dx, y + dy, z1, w, w, r() < 0.65 ? M.COAL : M.OLDWOOD);
  }
  // Soot patches over the heap.
  m.paintBox(-0.2, -0.2, 0.03, fp + 0.2, fp + 0.2, RUBBLE_HEIGHT, (x, y) => {
    const n = Math.sin(x * 23.1 + v * 3) * Math.sin(y * 19.3 - v) + 0.6 * Math.sin((x - y) * 13.7);
    return n > 1.15 ? M.COAL : 0;
  });
  // Loose dressed blocks spilt around the foot of the heap.
  for (let k = 0; k < fp + 2; k++) {
    const side = Math.floor(r() * 4);
    const t = r() * (fp - 0.3);
    const x = side === 0 ? -0.1 : side === 1 ? fp - 0.15 : t;
    const y = side === 2 ? -0.1 : side === 3 ? fp - 0.15 : t;
    blockPile(m, x, y, 1 + Math.floor(r() * 3), 0.09);
  }
  return m;
}
