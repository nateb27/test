/**
 * Building looks per age and their construction stages. Each look is built once; the scaffold and foundation
 * stages are derived from the finished model (walls cut down, roof gone, scaffolding and materials added).
 */

import type { BuildingKey } from '../../catalog';
import type { BuildingStage } from '../../manifest';
import { M } from '../materials';
import { vn2 } from '../noise';
import type { Model } from '../voxel';
import * as B from './buildings';
import { blockPile, buildingModel, ladder, logPileX, markOut, scaffold, trench } from './kit';
import { townCenter1, townCenter2, townCenter3, townCenter4 } from './townCenter';

export interface BuildingLook {
  /** e.g. 'house.early'. */
  id: string;
  key: BuildingKey;
  /** Ages (1..4) this look is shown in. */
  ages: readonly number[];
  late: boolean;
  fp: number;
  height: number;
  build: (m: Model) => void;
  /** Main body rectangle (footprint coords) for scaffolding and the foundation trench. */
  body: readonly [number, number, number, number];
  /** Wall height of the body. */
  wallH: number;
}

const L = (key: BuildingKey, tag: string, ages: number[], late: boolean, fp: number, height: number, build: (m: Model) => void, body: [number, number, number, number], wallH: number): BuildingLook => ({
  id: `${key}.${tag}`,
  key,
  ages,
  late,
  fp,
  height,
  build,
  body,
  wallH,
});

export const BUILDING_LOOKS: readonly BuildingLook[] = [
  L('townCenter', 'a1', [1], false, 4, 1.8, townCenter1, [0.45, 0.75, 3.35, 2.45], 0.8),
  L('townCenter', 'a2', [2], false, 4, 2.0, townCenter2, [0.42, 0.72, 3.38, 2.48], 0.86),
  L('townCenter', 'a3', [3], true, 4, 2.2, townCenter3, [0.5, 0.5, 3.5, 3.5], 0.95),
  L('townCenter', 'a4', [4], true, 4, 2.75, townCenter4, [0.45, 0.45, 3.55, 3.55], 1.0),
  L('house', 'early', [1, 2], false, 2, 1.15, B.house1, [0.4, 0.5, 1.6, 1.5], 0.56),
  L('house', 'late', [3, 4], true, 2, 1.45, B.house4, [0.25, 0.35, 1.75, 1.65], 1.0),
  L('mill', 'early', [1, 2], false, 2, 1.9, B.millEarly, [0.54, 0.54, 1.46, 1.46], 0.86),
  L('mill', 'late', [3, 4], true, 2, 2.15, B.millLate, [0.52, 0.52, 1.48, 1.48], 1.12),
  L('lumberCamp', 'early', [1, 2], false, 2, 1.05, B.lumberEarly, [0.27, 0.3, 1.73, 1.28], 0.6),
  L('lumberCamp', 'late', [3, 4], true, 2, 1.1, B.lumberLate, [0.22, 0.24, 1.78, 0.95], 0.62),
  L('miningCamp', 'early', [1, 2], false, 2, 1.0, B.miningEarly, [0.32, 0.32, 1.63, 1.1], 0.55),
  L('miningCamp', 'late', [3, 4], true, 2, 1.1, B.miningLate, [0.22, 0.22, 1.18, 0.98], 0.62),
  L('farm', 'early', [1, 2], false, 2, 0.6, B.farmEarly, [0.1, 0.1, 1.9, 1.9], 0.05),
  L('farm', 'late', [3, 4], true, 2, 0.6, B.farmLate, [0.1, 0.1, 1.9, 1.9], 0.05),
  L('barracks', 'early', [1, 2], false, 3, 1.4, B.barracksEarly, [0.3, 0.35, 2.7, 1.45], 0.66),
  L('barracks', 'late', [3, 4], true, 3, 1.75, B.barracksLate, [0.25, 0.25, 2.75, 1.55], 0.82),
  L('archeryRange', 'early', [2], false, 3, 1.2, B.archeryEarly, [0.22, 0.22, 2.28, 1.05], 0.6),
  L('archeryRange', 'late', [3, 4], true, 3, 1.3, B.archeryLate, [0.18, 0.18, 2.57, 1.12], 0.82),
  L('stable', 'early', [2], false, 3, 1.1, B.stableEarly, [0.27, 0.27, 2.73, 1.0], 0.55),
  L('stable', 'late', [3, 4], true, 3, 1.4, B.stableLate, [0.2, 0.2, 2.8, 1.18], 0.78),
  L('siegeWorkshop', 'late', [3, 4], true, 3, 1.6, B.siegeWorkshop, [0.17, 0.17, 2.83, 1.45], 0.95),
  L('silkWorkshop', 'late', [3, 4], true, 3, 1.5, B.silkWorkshop, [0.18, 0.18, 1.97, 1.37], 0.9),
];

/** The look shown for a building in an age: the one listing the age, else the nearest age it has. */
export function lookFor(key: BuildingKey, age: number): BuildingLook {
  const list = BUILDING_LOOKS.filter((l) => l.key === key);
  const exact = list.find((l) => l.ages.includes(age));
  if (exact !== undefined) return exact;
  let best = list[0]!;
  let bd = Infinity;
  for (const l of list) {
    for (const a of l.ages) {
      const d = Math.abs(a - age);
      if (d < bd) {
        bd = d;
        best = l;
      }
    }
  }
  return best;
}

/** Finished model of a look. */
export function buildLook(look: BuildingLook): Model {
  const m = buildingModel(look.fp, look.height);
  look.build(m);
  return m;
}

/** Derive a construction stage from a finished model (which it does not modify). */
export function stageModel(look: BuildingLook, done: Model, stage: BuildingStage): Model {
  if (stage === 'complete') return done;
  const m = done.clone();
  const [x0, y0, x1, y1] = look.body;
  const pad = 0.6;
  if (stage === 'scaffold') {
    // Part-built walls: everything above ~55% of the wall height is not there yet.
    const cut = look.key === 'farm' ? 0.035 : Math.max(0.12, look.wallH * 0.55);
    if (look.key === 'farm') m.carveBox(-pad, -pad, cut, look.fp + pad, look.fp + pad, look.height + 1);
    else {
      // Courses laid unevenly: the wall top steps up and down around the cut height.
      m.op(-pad, -pad, 0.04, look.fp + pad, look.fp + pad, look.height + 1, (x, y, z) => {
        const top = cut * (0.7 + 0.45 * vn2(x * 2.2 + 3, y * 2.2));
        return z > Math.floor(top / 0.045) * 0.045 ? 1 : 0;
      }, 1);
      // Hollow inside, with a trodden earth floor.
      m.carveBox(x0 + 0.07, y0 + 0.07, -0.01, x1 - 0.07, y1 - 0.07, look.height + 1);
      m.box(x0 + 0.07, y0 + 0.07, 0, x1 - 0.07, y1 - 0.07, 0.025, M.EARTH);
    }
    if (look.key === 'farm') {
      markOut(m, 0.05, 0.05, 1.95, 1.95);
      logPileX(m, 1.4, 1.9, 1.75, 1, 0.035);
      return m;
    }
    const top = cut + 0.28;
    scaffold(m, x0, y0, x1, y1, top, [cut * 0.5, cut]);
    ladder(m, x1 + 0.3, y1 - 0.2, x1 + 0.1, y1 - 0.25, cut + 0.1);
    if (look.late) blockPile(m, x0 + 0.1, Math.min(look.fp - 0.25, y1 + 0.25), 5, 0.1);
    else logPileX(m, x0 + 0.05, Math.min(x1, x0 + 0.8), Math.min(look.fp - 0.25, y1 + 0.2), 2, 0.04);
    return m;
  }
  // Foundation: only the footings, a dug trench around the body, stakes and line, a pile of material.
  m.carveBox(-pad, -pad, 0.07, look.fp + pad, look.fp + pad, look.height + 1);
  // Clear props outside the body so the plot reads as a site.
  m.carveBox(-pad, -pad, -0.01, look.fp + pad, y0 - 0.02, 0.08);
  m.carveBox(-pad, y1 + 0.02, -0.01, look.fp + pad, look.fp + pad, 0.08);
  m.carveBox(-pad, y0 - 0.02, -0.01, x0 - 0.02, y1 + 0.02, 0.08);
  m.carveBox(x1 + 0.02, y0 - 0.02, -0.01, look.fp + pad, y1 + 0.02, 0.08);
  if (look.key !== 'farm') {
    m.carveBox(x0 + 0.08, y0 + 0.08, -0.01, x1 - 0.08, y1 - 0.08, 0.1);
    m.box(x0 + 0.08, y0 + 0.08, 0, x1 - 0.08, y1 - 0.08, 0.02, M.EARTH);
    trench(m, x0 - 0.12, y0 - 0.12, x1 + 0.12, y1 + 0.12, 0.1);
  }
  markOut(m, x0 - 0.15, y0 - 0.15, x1 + 0.15, y1 + 0.15);
  if (look.key === 'farm') {
    m.op(0.15, 0.15, 0, 1.85, 1.85, 0.02, () => M.FURROW, 0);
    return m;
  }
  const py = Math.min(look.fp - 0.2, y1 + 0.3);
  if (look.late) blockPile(m, x0 + 0.15, py, 6, 0.1);
  else logPileX(m, x0 + 0.1, Math.min(x1, x0 + 0.9), py, 2, 0.04);
  return m;
}
