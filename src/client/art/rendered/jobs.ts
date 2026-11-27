/**
 * The render work behind the rendered art, split into jobs a worker (or the main thread, time-sliced) runs
 * independently. Each job yields named sprites or a terrain texture. Pure: no DOM, so it runs in workers and tests.
 */

import { UNIT_IDS, type UnitKey } from '../catalog';
import type { BuildingStage, BasicUnitState as UnitAnimState } from '../manifest';
import { BUILDING_LOOKS, buildLook, stageModel } from './models/looks';
import { berryModel, depositModel, TREE_VARIANTS, treeModel } from './models/nature';
import { RUBBLE_HEIGHT, rubbleModel } from './models/rubble';
import { unitModel } from './models/units';
import { frameForBox, renderSprite, type SpriteFrame, type SpriteOut } from './render';
import { renderTerrainTex, TERRAIN_KINDS, type TerrainKind, type TerrainTexOut } from './terrainTex';

export type Job =
  | { type: 'building'; look: string }
  | { type: 'unit'; key: UnitKey; state: UnitAnimState }
  | { type: 'unitIcon'; key: UnitKey }
  | { type: 'tree'; v: number }
  | { type: 'berry'; v: number }
  | { type: 'deposit'; gold: boolean; v: number }
  | { type: 'rubble'; fp: number; v: number }
  | { type: 'terrain'; kind: TerrainKind };

export interface NamedSprite {
  name: string;
  sprite: SpriteOut;
}

export interface JobResult {
  sprites: NamedSprite[];
  terrain: TerrainTexOut | null;
}

export const UNIT_STATES: readonly UnitAnimState[] = ['idle', 'walk', 'work', 'carry'];
export const BUILDING_STAGES: readonly BuildingStage[] = ['complete', 'scaffold', 'foundation'];
export const BERRY_VARIANTS = 2;
export const DEPOSIT_VARIANTS = 2;
/** Rubble of destroyed buildings (WP27): footprints 2, 3 and 4, two variants each. */
export const RUBBLE_SIZES: readonly number[] = [2, 3, 4];
export const RUBBLE_VARIANTS = 2;
export const rubbleSpriteName = (fp: number, v: number): string => `rubble.${fp}|${v}`;

/** Frame of the rubble of a footprint: the building frame's ground box, low. */
export function rubbleFrame(fp: number): SpriteFrame {
  const e = fp / 2 + 0.45;
  return frameForBox(-e, -e, e, e, RUBBLE_HEIGHT);
}

/** Frames (output px) per unit size class: the procedural art's sizes, so picking boxes behave the same. */
const HUMAN: SpriteFrame = { w: 64, h: 68, ax: 32, ay: 56 };
const HORSE: SpriteFrame = { w: 104, h: 96, ax: 52, ay: 76 };
const SIEGE: SpriteFrame = { w: 128, h: 112, ax: 64, ay: 86 };
export const UNIT_FRAMES: Readonly<Record<UnitKey, SpriteFrame>> = {
  villager: HUMAN,
  spearman: HUMAN,
  swordsman: HUMAN,
  archer: HUMAN,
  siphonarios: HUMAN,
  horseman: HORSE,
  lancer: HORSE,
  cataphract: HORSE,
  batteringRam: SIEGE,
  trebuchet: SIEGE,
};

/** Which rendered state a unit state uses: only villagers carry something, the others reuse their walk. */
export function unitStateSource(key: UnitKey, state: UnitAnimState): UnitAnimState {
  return state === 'carry' && key !== 'villager' ? 'walk' : state;
}

/** One frame per building id, big enough for every look (all sprites of an id share its anchor). */
export function buildingFrame(key: string): SpriteFrame {
  const looks = BUILDING_LOOKS.filter((l) => l.key === key);
  const fp = looks[0]?.fp ?? 2;
  const h = Math.max(...looks.map((l) => l.height));
  const e = fp / 2 + 0.45;
  return frameForBox(-e, -e, e, e, h);
}

export const NODE_FRAMES: Readonly<Record<string, SpriteFrame>> = {
  tree: frameForBox(-0.85, -0.85, 0.85, 0.85, 2.3),
  berryBush: frameForBox(-0.7, -0.7, 0.7, 0.7, 0.5),
  goldDeposit: frameForBox(-1.3, -1.3, 1.3, 1.3, 1.25),
  stoneDeposit: frameForBox(-1.3, -1.3, 1.3, 1.3, 1.25),
};

/** Jobs the first age needs: rendered before the match starts. Everything else renders in the background. */
export function isEssential(j: Job): boolean {
  switch (j.type) {
    case 'building':
      return BUILDING_LOOKS.find((l) => l.id === j.look)?.ages.includes(1) === true;
    case 'unit':
    case 'unitIcon':
      return j.key === 'villager' || j.key === 'spearman';
    case 'rubble':
      return false;
    default:
      return true;
  }
}

export const unitSpriteName = (key: string, state: string, facing: number, frame: number): string => `unit.${key}|${state}|${facing}|${frame}`;
export const buildingSpriteName = (look: string, stage: string): string => `building.${look}|${stage}`;

/** Every job, heaviest first (better load balancing across workers). */
export function allJobs(): Job[] {
  const jobs: Job[] = [];
  const looks = [...BUILDING_LOOKS].sort((a, b) => b.fp * b.fp * b.height - a.fp * a.fp * a.height);
  for (const l of looks) jobs.push({ type: 'building', look: l.id });
  for (const kind of TERRAIN_KINDS) jobs.push({ type: 'terrain', kind });
  for (let g = 0; g < DEPOSIT_VARIANTS; g++) {
    jobs.push({ type: 'deposit', gold: true, v: g });
    jobs.push({ type: 'deposit', gold: false, v: g });
  }
  for (const key of UNIT_IDS) for (const state of UNIT_STATES) if (unitStateSource(key, state) === state) jobs.push({ type: 'unit', key, state });
  for (let v = 0; v < TREE_VARIANTS.length; v++) jobs.push({ type: 'tree', v });
  for (let v = 0; v < BERRY_VARIANTS; v++) jobs.push({ type: 'berry', v });
  for (const key of UNIT_IDS) jobs.push({ type: 'unitIcon', key });
  for (const fp of RUBBLE_SIZES) for (let v = 0; v < RUBBLE_VARIANTS; v++) jobs.push({ type: 'rubble', fp, v });
  return jobs;
}

/** Rough relative cost, for progress reporting. */
export function jobCost(j: Job): number {
  switch (j.type) {
    case 'building': {
      const l = BUILDING_LOOKS.find((b) => b.id === j.look);
      return l === undefined ? 1 : 2 + l.fp * l.fp * l.height * 1.2;
    }
    case 'unit':
      return j.key === 'trebuchet' || j.key === 'batteringRam' ? 8 : UNIT_FRAMES[j.key] === HORSE ? 7 : 5;
    case 'terrain':
      return 10;
    case 'deposit':
      return 6;
    case 'tree':
      return 3;
    case 'berry':
      return 1;
    case 'unitIcon':
      return 1;
    case 'rubble':
      return 1 + j.fp;
  }
}

/** Run one job. A generator so the main-thread fallback can slice it. */
export function* runJob(job: Job, raw = false): Generator<void, JobResult, void> {
  const sprites: NamedSprite[] = [];
  switch (job.type) {
    case 'building': {
      const look = BUILDING_LOOKS.find((l) => l.id === job.look);
      if (look === undefined) break;
      const done = buildLook(look);
      yield;
      for (const stage of BUILDING_STAGES) {
        const m = stageModel(look, done, stage);
        yield;
        const sprite = yield* renderSprite({ models: [m], ss: 2, raw, frame: buildingFrame(look.key) });
        sprites.push({ name: buildingSpriteName(look.id, stage), sprite });
      }
      break;
    }
    case 'unit': {
      const frames = job.state === 'idle' ? 1 : 2;
      for (let frame = 0; frame < frames; frame++) {
        for (let facing = 0; facing < 8; facing++) {
          const m = unitModel(job.key, job.state, frame, facing);
          const sprite = yield* renderSprite({ models: [m], ss: 2, unitPost: true, frame: UNIT_FRAMES[job.key], raw });
          sprites.push({ name: unitSpriteName(job.key, job.state, facing, frame), sprite });
        }
      }
      break;
    }
    case 'unitIcon': {
      const facing = job.key === 'horseman' || job.key === 'lancer' || job.key === 'cataphract' ? 0 : 1;
      const m = unitModel(job.key, 'idle', 0, facing, 1.6);
      const sprite = yield* renderSprite({ models: [m], ss: 2, scale: 2.5, shadow: false, raw });
      sprites.push({ name: `icon.unit.${job.key}`, sprite });
      break;
    }
    case 'tree': {
      const sprite = yield* renderSprite({ models: [treeModel(job.v)], ss: 2, raw, frame: NODE_FRAMES.tree! });
      sprites.push({ name: `node.tree|${job.v}`, sprite });
      break;
    }
    case 'berry': {
      const sprite = yield* renderSprite({ models: [berryModel(job.v)], ss: 2, raw, frame: NODE_FRAMES.berryBush! });
      sprites.push({ name: `node.berryBush|${job.v}`, sprite });
      break;
    }
    case 'deposit': {
      const sprite = yield* renderSprite({ models: [depositModel(job.gold, job.v)], ss: 2, raw, frame: NODE_FRAMES[job.gold ? 'goldDeposit' : 'stoneDeposit']! });
      sprites.push({ name: `node.${job.gold ? 'goldDeposit' : 'stoneDeposit'}|${job.v}`, sprite });
      break;
    }
    case 'rubble': {
      const sprite = yield* renderSprite({ models: [rubbleModel(job.fp, job.v)], ss: 2, raw, frame: rubbleFrame(job.fp) });
      sprites.push({ name: rubbleSpriteName(job.fp, job.v), sprite });
      break;
    }
    case 'terrain': {
      const terrain = yield* renderTerrainTex(job.kind, raw);
      return { sprites, terrain };
    }
  }
  return { sprites, terrain: null };
}

/** Buffers in a result, for zero-copy transfer out of a worker. */
export function transferables(r: JobResult): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  for (const s of r.sprites) {
    out.push(s.sprite.rgba.buffer as ArrayBuffer, s.sprite.team.buffer as ArrayBuffer);
  }
  if (r.terrain !== null) out.push(r.terrain.rgba.buffer as ArrayBuffer);
  return out;
}
