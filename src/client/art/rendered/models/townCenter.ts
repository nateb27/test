/** Town Center, one look per age: timber hall, plastered hall with stone tower, stone cross-plan, domed church-hall. */

import { M } from '../materials';
import { fract } from '../noise';
import type { Model } from '../voxel';
import { banner, barrel, crate, logY, palisade, ridge, sack, wallBanner } from './kit';

/** Age I: timber hall, wattle and daub, thatch, rough footing, watch tower and palisade. */
export function townCenter1(m: Model): void {
  m.box(0.4, 0.7, 0, 3.4, 2.5, 0.17, M.RUBBLE);
  m.box(0.45, 0.75, 0.17, 3.35, 2.45, 0.8, M.DAUB);
  for (let x = 0.45; x <= 3.36; x += 0.36) m.box(x - 0.03, 2.43, 0.17, x + 0.03, 2.49, 0.8, M.TIMBV);
  for (let y = 0.75; y <= 2.46; y += 0.34) m.box(3.33, y - 0.03, 0.17, 3.39, y + 0.03, 0.8, M.TIMBV);
  m.box(0.45, 2.43, 0.17, 3.36, 2.5, 0.22, M.TIMBH);
  m.box(0.45, 2.43, 0.74, 3.36, 2.5, 0.8, M.TIMBH);
  m.box(3.33, 0.75, 0.17, 3.4, 2.46, 0.22, M.TIMBH);
  m.box(3.33, 0.75, 0.74, 3.4, 2.46, 0.8, M.TIMBH);
  m.op(0.45, 2.43, 0.2, 3.36, 2.5, 0.7, (x, y, z) => {
    const f = fract((x - 0.45) / 0.72);
    const t = (z - 0.22) / 0.44;
    return y > 2.44 && Math.abs(f - t * 0.5) < 0.04 && f < 0.5 ? M.TIMBV : 0;
  }, 0);
  m.hip(0.3, 0.6, 3.5, 2.6, 0.76, 1.0, 0.78, 0.14, M.THATCH, { jit: 0.04, js: 7, sag: 0.07, fill: M.DAUB });
  m.capsule(1.2, 1.6, 1.5, 2.6, 1.6, 1.5, 0.05, 0.05, M.THATCH);
  m.box(1.75, 2.42, 0.17, 2.15, 2.5, 0.6, M.DOOR);
  m.carveBox(1.75, 2.47, 0.17, 2.15, 2.52, 0.6);
  m.box(1.7, 2.47, 0.6, 2.2, 2.53, 0.65, M.TIMBH);
  m.carveBox(2.6, 2.4, 0.38, 2.75, 2.52, 0.5);
  m.carveBox(1.0, 2.4, 0.38, 1.15, 2.52, 0.5);
  m.carveBox(3.3, 1.2, 0.38, 3.42, 1.35, 0.5);
  m.carveBox(3.3, 1.85, 0.38, 3.42, 2.0, 0.5);
  // Painted shutters (team colour).
  for (const x of [0.96, 1.15, 2.56, 2.75]) m.box(x - 0.02, 2.5, 0.37, x + 0.02, 2.53, 0.51, M.BLUEPAINT);
  // Annex.
  m.box(2.25, 2.5, 0, 3.35, 3.45, 0.12, M.RUBBLE);
  m.box(2.3, 2.5, 0.12, 3.3, 3.4, 0.5, M.PLANK);
  m.gable(2.15, 2.4, 3.45, 3.55, 0.5, 0.36, 'y', 0.06, M.SHINGLE, { sag: 0.03, jit: 0.02, fill: M.PLANK });
  m.box(2.65, 3.38, 0.12, 2.9, 3.42, 0.42, M.DOOR);
  // Watch tower.
  const tx = 0.55;
  const ty = 2.75;
  const s = 0.6;
  for (const [a, b] of [[0, 0], [s, 0], [0, s], [s, s]] as const) m.box(tx + a - 0.035, ty + b - 0.035, 0, tx + a + 0.035, ty + b + 0.035, 1.3, M.TIMBV);
  m.box(tx - 0.08, ty - 0.08, 0.92, tx + s + 0.08, ty + s + 0.08, 0.97, M.PLANK);
  m.box(tx - 0.08, ty + s + 0.05, 0.97, tx + s + 0.08, ty + s + 0.08, 1.12, M.OLDWOOD);
  m.box(tx + s + 0.05, ty - 0.08, 0.97, tx + s + 0.08, ty + s + 0.08, 1.12, M.OLDWOOD);
  m.op(tx, ty + s - 0.03, 0.05, tx + s, ty + s + 0.03, 0.9, (x, _y, z) => {
    const t = (x - tx) / s;
    return Math.abs(z - 0.05 - t * 0.85) < 0.035 || Math.abs(z - 0.9 + t * 0.85) < 0.035 ? M.TIMBV : 0;
  }, 0);
  m.op(tx + s - 0.03, ty, 0.05, tx + s + 0.03, ty + s, 0.9, (_x, y, z) => (Math.abs(z - 0.05 - ((y - ty) / s) * 0.85) < 0.035 ? M.TIMBV : 0), 0);
  m.hip(tx - 0.16, ty - 0.16, tx + s + 0.16, ty + s + 0.16, 1.28, 1.2, 0.4, 0.1, M.THATCH, { jit: 0.04 });
  banner(m, tx + s + 0.12, ty + s + 0.12, 1.2, 0.36, 0.15);
  palisade(m, 0.15, 3.85, 1.9, 3.85, 0.42);
  m.box(0.12, 3.78, 0.25, 1.9, 3.8, 0.29, M.TIMBH);
  for (let r = 0; r < 3; r++) for (let k = 0; k < 4 - r; k++) logY(m, 3.5, 3.95, 3.45 + k * 0.1 + r * 0.05, 0.05 + r * 0.085, 0.048);
  barrel(m, 1.5, 2.72, 0.06, 0.14);
  barrel(m, 1.36, 2.66, 0.055, 0.13);
  sack(m, 2.35, 2.62, 0);
  sack(m, 2.45, 2.7, 0);
  wallBanner(m, 'y', 1.45, 2.5, 0.72, 0.3, 0.13);
}

/** Age II: the hall rebuilt on a stone plinth, plastered and timber framed, tiled; the tower is now stone. */
export function townCenter2(m: Model): void {
  m.box(0.35, 0.65, 0, 3.45, 2.55, 0.22, M.RUBBLE);
  m.box(0.42, 0.72, 0.22, 3.38, 2.48, 0.86, M.PLASTER);
  for (let x = 0.42; x <= 3.39; x += 0.42) m.box(x - 0.03, 2.46, 0.22, x + 0.03, 2.52, 0.86, M.TIMBV);
  for (let y = 0.72; y <= 2.49; y += 0.44) m.box(3.36, y - 0.03, 0.22, 3.42, y + 0.03, 0.86, M.TIMBV);
  m.box(0.42, 2.46, 0.8, 3.4, 2.53, 0.86, M.TIMBH);
  m.box(3.36, 0.72, 0.8, 3.43, 2.5, 0.86, M.TIMBH);
  const s1 = m.gable(0.28, 0.55, 3.52, 2.65, 0.84, 0.62, 'x', 0.08, M.TILE, { sag: 0.05, jit: 0.016, fill: M.PLASTER });
  ridge(m, s1, 'x', 0.28, 3.52, 1.6, M.BRICK);
  // Porch on the front.
  m.box(1.55, 2.5, 0, 2.45, 2.95, 0.08, M.ASHLAR);
  for (const x of [1.62, 2.38]) m.box(x - 0.04, 2.84, 0.08, x + 0.04, 2.92, 0.62, M.TIMBV);
  m.gable(1.45, 2.42, 2.55, 3.05, 0.62, 0.26, 'y', 0.05, M.TILE, { jit: 0.01 });
  m.box(1.82, 2.45, 0.22, 2.18, 2.53, 0.68, M.DOOR);
  for (const x of [0.85, 1.25, 2.75, 3.1]) {
    m.carveBox(x - 0.07, 2.42, 0.42, x + 0.07, 2.53, 0.62);
    m.box(x - 0.11, 2.52, 0.4, x - 0.07, 2.55, 0.64, M.BLUEPAINT);
    m.box(x + 0.07, 2.52, 0.4, x + 0.11, 2.55, 0.64, M.BLUEPAINT);
  }
  for (const y of [1.1, 1.6, 2.1]) m.carveBox(3.33, y - 0.07, 0.42, 3.44, y + 0.07, 0.62);
  // Stone tower.
  const tx = 0.4;
  const ty = 2.7;
  m.box(tx, ty, 0, tx + 0.8, ty + 0.8, 1.45, M.RUBBLE);
  m.box(tx - 0.03, ty - 0.03, 1.34, tx + 0.83, ty + 0.83, 1.42, M.ASHLAR);
  m.hip(tx - 0.1, ty - 0.1, tx + 0.9, ty + 0.9, 1.42, 1.1, 0.42, 0.08, M.TILE, { jit: 0.01 });
  m.arch('y', tx + 0.4, ty + 0.8, 0.12, 0.12, 1.0, 0.12, 1);
  m.arch('x', ty + 0.4, tx + 0.8, 0.12, 0.12, 1.0, 0.12, 1);
  m.arch('y', tx + 0.4, ty + 0.8, 0.12, 0.2, 0.0, 0.26, 1);
  m.box(tx + 0.3, ty + 0.75, 0, tx + 0.5, ty + 0.78, 0.36, M.DOOR);
  wallBanner(m, 'x', ty + 0.4, tx + 0.8, 0.9, 0.36, 0.16);
  wallBanner(m, 'y', tx + 0.4, ty + 0.8, 0.88, 0.3, 0.14);
  banner(m, 3.6, 2.85, 1.0, 0.36, 0.15);
  // Yard wall and stores.
  m.box(1.5, 3.7, 0, 3.75, 3.85, 0.26, M.RUBBLE);
  m.box(3.6, 2.75, 0, 3.75, 3.85, 0.26, M.RUBBLE);
  barrel(m, 3.3, 3.4, 0.06, 0.14);
  barrel(m, 3.15, 3.5, 0.055, 0.13);
  crate(m, 2.75, 3.3, 0.13);
  sack(m, 1.9, 3.4, 0);
  sack(m, 2.0, 3.48, 0);
  sack(m, 1.95, 3.44, 0.08);
  for (let r = 0; r < 2; r++) for (let k = 0; k < 3 - r; k++) logY(m, 0.5, 1.2, 3.62 + k * 0.1 + r * 0.05, 0.05 + r * 0.085, 0.048);
}

/** Age III: dressed stone with brick banding on a cross plan, tiled arms, a low drum and dome, arcades. */
export function townCenter3(m: Model): void {
  const W = M.BYZ;
  m.box(0.2, 0.2, 0, 3.8, 3.8, 0.08, M.ASHLAR);
  m.box(0.5, 1.35, 0.08, 3.5, 2.65, 0.95, W);
  m.box(1.35, 0.5, 0.08, 2.65, 3.5, 0.95, W);
  m.box(1.1, 1.1, 0.08, 2.9, 2.9, 1.25, W);
  m.box(0.47, 1.32, 0.9, 3.53, 2.68, 0.95, M.ASHLAR);
  m.box(1.32, 0.47, 0.9, 2.68, 3.53, 0.95, M.ASHLAR);
  const sx = m.gable(0.4, 1.26, 3.6, 2.74, 0.95, 0.4, 'x', 0.07, M.TILE, { sag: 0.03, jit: 0.014, fill: W });
  const sy = m.gable(1.26, 0.4, 2.74, 3.6, 0.95, 0.4, 'y', 0.07, M.TILE, { sag: 0.03, jit: 0.014, fill: W });
  ridge(m, sx, 'x', 0.4, 3.6, 2.0, M.BRICK);
  ridge(m, sy, 'y', 0.4, 3.6, 2.0, M.BRICK);
  m.hip(1.05, 1.05, 2.95, 2.95, 1.25, 0.35, 0.18, 0.06, M.TILE, { jit: 0.01 });
  m.cyl(2, 2, 0.5, 1.25, 1.55, W);
  m.cyl(2, 2, 0.54, 1.52, 1.58, M.ASHLAR);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + 0.2;
    const cx = 2 + Math.cos(a) * 0.5;
    const cy = 2 + Math.sin(a) * 0.5;
    m.op(cx - 0.06, cy - 0.06, 1.33, cx + 0.06, cy + 0.06, 1.48, (x, y, z) => (Math.hypot(x - cx, y - cy) < 0.045 && z < 1.46 ? 1 : 0), 1);
  }
  m.dome(2, 2, 1.58, 0.52, 0.75, M.LEAD);
  m.capsule(2, 2, 1.95, 2, 2, 2.08, 0.012, 0.012, M.METAL);
  m.capsule(1.96, 2.04, 2.04, 2.04, 1.96, 2.04, 0.01, 0.01, M.METAL);
  for (const c of [1.7, 2.0, 2.3]) {
    const big = c === 2.0;
    m.arch('x', c, 3.5, 0.15, big ? 0.26 : 0.18, 0.08, big ? 0.34 : 0.28, 1);
    m.archRing('x', c, 3.5, 0.15, big ? 0.26 : 0.18, 0.08, big ? 0.34 : 0.28, 0.04, M.BRICK);
    m.arch('y', c, 3.5, 0.15, big ? 0.28 : 0.18, 0.08, big ? 0.36 : 0.28, 1);
    m.archRing('y', c, 3.5, 0.15, big ? 0.28 : 0.18, 0.08, big ? 0.36 : 0.28, 0.04, M.BRICK);
  }
  m.box(1.86, 3.33, 0.08, 2.14, 3.37, 0.64, M.DOOR);
  m.box(3.33, 1.87, 0.08, 3.37, 2.13, 0.56, M.DOOR);
  for (const x of [3.0, 3.3]) {
    m.arch('y', x, 2.65, 0.12, 0.11, 0.42, 0.16, 1);
    m.archRing('y', x, 2.65, 0.12, 0.11, 0.42, 0.16, 0.03, M.BRICK);
  }
  for (const y of [3.0, 3.3]) {
    m.arch('x', y, 2.65, 0.12, 0.11, 0.42, 0.16, 1);
    m.archRing('x', y, 2.65, 0.12, 0.11, 0.42, 0.16, 0.03, M.BRICK);
  }
  // Courtyard corners: low walls, a well, stores.
  m.box(0.3, 0.3, 0.08, 1.2, 0.42, 0.4, M.RUBBLE);
  m.box(0.3, 0.3, 0.08, 0.42, 1.2, 0.4, M.RUBBLE);
  m.box(2.85, 2.85, 0.08, 3.6, 2.95, 0.3, M.RUBBLE);
  m.cyl(3.2, 3.2, 0.13, 0.08, 0.26, M.RUBBLE);
  m.cyl(3.2, 3.2, 0.09, 0.2, 0.27, M.DARK);
  for (const [a, b] of [[3.1, 3.1], [3.3, 3.3]] as const) m.box(a - 0.015, b - 0.015, 0.26, a + 0.015, b + 0.015, 0.5, M.OLDWOOD);
  m.capsule(3.1, 3.1, 0.49, 3.3, 3.3, 0.49, 0.012, 0.012, M.OLDWOOD);
  banner(m, 3.72, 2.8, 1.0, 0.42, 0.16);
  banner(m, 2.8, 3.72, 1.0, 0.42, 0.16);
  wallBanner(m, 'y', 1.75, 3.5, 0.8, 0.32, 0.12);
  wallBanner(m, 'y', 2.25, 3.5, 0.8, 0.32, 0.12);
  barrel(m, 3.65, 1.1, 0.065, 0.15);
  crate(m, 3.45, 0.62, 0.13);
  sack(m, 1.15, 3.7, 0.08);
  sack(m, 1.03, 3.62, 0.08);
}

/** Age IV: the full domed hall (dressed stone, brick bands, tiled arms, corner chapels, arcades, lead dome). */
export function townCenter4(m: Model): void {
  const W = M.BYZ;
  m.box(0.1, 0.1, 0, 3.9, 3.9, 0.06, M.ASHLAR);
  m.box(0.2, 0.2, 0.06, 3.8, 3.8, 0.11, M.ASHLAR);
  m.box(0.45, 1.4, 0.11, 3.55, 2.6, 1.0, W);
  m.box(1.4, 0.45, 0.11, 2.6, 3.55, 1.0, W);
  m.box(1.08, 1.08, 0.11, 2.92, 2.92, 1.4, W);
  m.box(0.42, 1.37, 0.95, 3.58, 2.63, 1.0, M.ASHLAR);
  m.box(1.37, 0.42, 0.95, 2.63, 3.58, 1.0, M.ASHLAR);
  m.box(1.05, 1.05, 1.35, 2.95, 2.95, 1.4, M.ASHLAR);
  for (const x of [2.95, 3.25, 3.52, 0.48, 1.05]) m.box(x - 0.04, 2.58, 0.11, x + 0.04, 2.63, 0.95, M.ASHLAR);
  for (const y of [2.95, 3.25, 3.52, 0.48, 1.05]) m.box(2.58, y - 0.04, 0.11, 2.63, y + 0.04, 0.95, M.ASHLAR);
  for (const [cx, cy] of [[0.62, 0.62], [2.68, 0.62], [0.62, 2.68], [2.68, 2.68]] as const) {
    m.box(cx, cy, 0.11, cx + 0.7, cy + 0.7, 0.74, W);
    m.box(cx - 0.03, cy - 0.03, 0.7, cx + 0.73, cy + 0.73, 0.75, M.ASHLAR);
    m.cyl(cx + 0.35, cy + 0.35, 0.29, 0.75, 0.84, W);
    m.op(cx, cy, 0.84, cx + 0.7, cy + 0.7, 1.2, (x, y, z) => {
      const a = (x - cx - 0.35) / 0.3;
      const b = (y - cy - 0.35) / 0.3;
      const c = (z - 0.84) / 0.27;
      return a * a + b * b + c * c < 1 ? M.TILE : 0;
    }, 0);
    m.arch('x', cy + 0.35, cx + 0.7, 0.1, 0.12, 0.38, 0.14, 1);
    m.arch('y', cx + 0.35, cy + 0.7, 0.1, 0.12, 0.38, 0.14, 1);
    m.archRing('x', cy + 0.35, cx + 0.7, 0.1, 0.12, 0.38, 0.14, 0.035, M.BRICK);
    m.archRing('y', cx + 0.35, cy + 0.7, 0.1, 0.12, 0.38, 0.14, 0.035, M.BRICK);
  }
  const sx = m.gable(0.36, 1.31, 3.64, 2.69, 1.0, 0.42, 'x', 0.07, M.TILE, { sag: 0.035, jit: 0.014, fill: W });
  const sy = m.gable(1.31, 0.36, 2.69, 3.64, 1.0, 0.42, 'y', 0.07, M.TILE, { sag: 0.035, jit: 0.014, fill: W });
  ridge(m, sx, 'x', 0.36, 3.64, 2.0, M.BRICK);
  ridge(m, sy, 'y', 0.36, 3.64, 2.0, M.BRICK);
  m.hip(1.0, 1.0, 3.0, 3.0, 1.4, 0.35, 0.2, 0.06, M.TILE, { jit: 0.01 });
  m.cyl(2, 2, 0.64, 1.4, 1.8, W);
  m.cyl(2, 2, 0.68, 1.76, 1.82, M.ASHLAR);
  m.op(1.2, 1.2, 1.5, 2.8, 2.8, 1.72, (x, y, z) => {
    const dx = x - 2;
    const dy = y - 2;
    if (Math.hypot(dx, dy) < 0.5) return 0;
    const f = fract((Math.atan2(dy, dx) / (Math.PI * 2)) * 12);
    if (Math.abs(f - 0.5) > 0.16) return 0;
    return z < 1.66 + 0.04 * Math.cos(((f - 0.5) / 0.16) * 1.57) ? 1 : 0;
  }, 1);
  m.dome(2, 2, 1.82, 0.66, 0.9, M.LEAD);
  m.cyl(2, 2, 0.05, 2.38, 2.46, M.LEAD);
  m.capsule(2, 2, 2.46, 2, 2, 2.6, 0.013, 0.013, M.GOLDTRIM);
  m.capsule(1.95, 2.05, 2.55, 2.05, 1.95, 2.55, 0.011, 0.011, M.GOLDTRIM);
  for (const c of [1.68, 2.0, 2.32]) {
    const big = c === 2.0;
    m.arch('x', c, 3.55, 0.17, big ? 0.28 : 0.22, 0.11, big ? 0.36 : 0.32, 1);
    m.archRing('x', c, 3.55, 0.17, big ? 0.28 : 0.22, 0.11, big ? 0.36 : 0.32, 0.045, M.BRICK);
    m.arch('y', c, 3.55, 0.17, big ? 0.3 : 0.22, 0.11, big ? 0.38 : 0.32, 1);
    m.archRing('y', c, 3.55, 0.17, big ? 0.3 : 0.22, 0.11, big ? 0.38 : 0.32, 0.045, M.BRICK);
  }
  m.box(1.84, 3.35, 0.11, 2.16, 3.39, 0.7, M.DOOR);
  m.box(3.35, 1.86, 0.11, 3.39, 2.14, 0.6, M.DOOR);
  m.arch('x', 2.0, 3.55, 0.08, 0.12, 1.06, 0.0, 1);
  m.arch('y', 2.0, 3.55, 0.08, 0.12, 1.06, 0.0, 1);
  for (const x of [3.1, 3.38]) {
    m.arch('y', x, 2.6, 0.12, 0.11, 0.46, 0.16, 1);
    m.archRing('y', x, 2.6, 0.12, 0.11, 0.46, 0.16, 0.03, M.BRICK);
  }
  for (const y of [3.1, 3.38]) {
    m.arch('x', y, 2.6, 0.12, 0.11, 0.46, 0.16, 1);
    m.archRing('x', y, 2.6, 0.12, 0.11, 0.46, 0.16, 0.03, M.BRICK);
  }
  for (const c of [1.3, 1.65, 2.35, 2.7]) {
    m.arch('x', c, 2.92, 0.1, 0.1, 1.06, 0.12, 1);
    m.arch('y', c, 2.92, 0.1, 0.1, 1.06, 0.12, 1);
  }
  banner(m, 3.72, 2.86, 1.05, 0.44, 0.17);
  banner(m, 2.86, 3.72, 1.05, 0.44, 0.17);
  wallBanner(m, 'y', 1.5, 3.55, 0.88, 0.36, 0.13);
  wallBanner(m, 'x', 1.5, 3.55, 0.88, 0.36, 0.13);
  barrel(m, 3.66, 1.12, 0.065, 0.15);
  barrel(m, 3.62, 0.95, 0.06, 0.14);
  crate(m, 3.45, 0.62, 0.13);
  sack(m, 1.18, 3.7, 0.11);
  sack(m, 1.06, 3.62, 0.11);
  sack(m, 1.12, 3.66, 0.2);
  crate(m, 0.62, 3.55, 0.12, 0.12, 0.11);
  barrel(m, 3.72, 3.4, 0.06, 0.14, 0.11);
}
