/**
 * The difficulty table (PLAN-M2 6.3) and the AI's composition knowledge (6.4). These are habits, not game balance:
 * every number the rules use lives in `src/data`. No difficulty gets a resource or vision bonus; the only levers
 * are how fast and how well the AI decides.
 */

import type { AiDifficulty, ResourceType, UnitId } from '../../sim';
import { PLAN, type BotPlan } from '../plan';

/** Unit classes the composition logic reasons about (the 5.3 matrix rows and columns). */
export type UnitClass = 'spear' | 'sword' | 'archer' | 'horse' | 'heavyCav' | 'siege' | 'villager';

export type TargetChoice = 'nearest' | 'priority' | 'armyAware';
export type VillagerResponse = 'none' | 'evacuate' | 'fightSmall';
export type RebuildPolicy = 'housesAndCenter' | 'desired' | 'all';
export type UpgradePolicy = 'none' | 'topTwoLevelOne' | 'all';

export interface WaveSchedule {
  /** Seconds of game time for the earliest launch of the first wave, plus a uniform jitter of 0..`jitter` s. */
  earliest: number;
  jitter: number;
  /** Seconds after the earliest tick at which a wave launches with at least half its threshold (and >= 3). */
  forcedAfter: number;
  /** Launch thresholds of waves 1, 2, ...; beyond the list, the last entry grows by `growth` up to `cap`. */
  sizes: readonly number[];
  growth: number;
  cap: number;
  /** From this wave on, new units stream to the active wave instead of waiting (hard: "continuous reinforcement"). */
  reinforceFromWave: number | null;
  /** Seconds between the end of one wave and the earliest launch of the next. */
  interval: number;
}

export interface SiegePlan {
  /** Rams kept per wave from Age 3 (0 = never). */
  rams: number;
  /** Age 4 additions. */
  trebuchets: number;
  siphonarioi: number;
}

export interface DifficultyProfile {
  id: AiDifficulty;
  decisionInterval: number;
  villagerTarget: number;
  /** First Barracks once this many villagers exist, or at `seconds` (whichever comes first; null = never by time). */
  firstBarracks: { villagers: number; seconds: number | null };
  /** Extra military buildings once the age is reached: [age, building, count wanted in total]. */
  militaryBuildings: readonly { age: number; type: string; count: number }[];
  /** Share of income banked for the army once the first Barracks stands (6.3, 6.4). */
  armyShare: number;
  wave: WaveSchedule;
  /** Composition weight `c` of 6.4: 0 = fixed table, 1 = pure counter. */
  counterWeight: number;
  fixed: Readonly<Partial<Record<UnitClass, number>>>;
  upgrades: UpgradePolicy;
  upgradesFromAge: number;
  siege: SiegePlan;
  maxAge: number;
  target: TargetChoice;
  /** Retreat when wave power falls below this share of its start power (null: never). */
  retreatBelow: number | null;
  /** Seconds a threat must persist before the AI responds. */
  reactionDelay: number;
  villagers: VillagerResponse;
  repair: boolean;
  rebuild: RebuildPolicy;
  /** Seconds of game time after which every unit attacks continuously (null: never). */
  allIn: number | null;
  /** The economy plan handed to `decide`. */
  plan: BotPlan;
}

/** Spend from the army reserve or from surplus above this per resource (6.4). */
export const SURPLUS_ABOVE = 400;
/** The army bank never holds more than this per resource; income beyond it stays with the economy. */
export const BANK_CAP = 250;
/** Rally point distance from the Town Center towards the enemy (6.4). */
export const RALLY_DISTANCE = 10;
/** Threat radius around own buildings, clustering link radius (6.6). */
export const THREAT_RADIUS = 20;
export const CLUSTER_LINK = 6;
/** Fighting units of a wave farther than this from home do not answer a threat (6.6). */
export const WAVE_HOME_RADIUS = 30;
/** A threat must be gone this long before evacuated villagers go back to work (6.6). */
export const THREAT_CLEAR_SECONDS = 10;
/** Repair: below this share of max hp, with no enemy within this radius (6.6). */
export const REPAIR_BELOW = 0.7;
export const REPAIR_SAFE_RADIUS = 8;
/** Bucket grid cell side for threat and cluster queries (6.7). */
export const BUCKET_CELL = 8;

/**
 * The 5.3 counter matrix as numbers (W = 1.0, w = 0.5, L = -0.5, untested = 0): how well a unit of the row class
 * does against an enemy of the column class.
 */
export const COUNTER: Readonly<Record<UnitClass, Readonly<Partial<Record<UnitClass, number>>>>> = {
  spear: { sword: -0.5, archer: -0.5, horse: 1, heavyCav: 0.5, siege: 1 },
  sword: { spear: 1, archer: -0.5, horse: 1, siege: 1 },
  archer: { spear: 1, sword: 0.5, horse: -0.5, heavyCav: -0.5 },
  horse: { sword: -0.5, archer: 1, heavyCav: -0.5, siege: 1 },
  heavyCav: { spear: -0.5, sword: 1, archer: 1, horse: 1, siege: 1 },
  siege: {},
  villager: {},
};

/** Class of each unit def the AI knows. Unknown ids count as swords (generalists). */
export const UNIT_CLASS: Readonly<Record<string, UnitClass>> = {
  villager: 'villager',
  spearman: 'spear',
  swordsman: 'sword',
  archer: 'archer',
  horseman: 'horse',
  lancer: 'heavyCav',
  cataphract: 'heavyCav',
  batteringRam: 'siege',
  trebuchet: 'siege',
  siphonarios: 'sword',
};

/** The unit the AI trains for a class (cavalry: the Cataphract replaces the Horseman from Age 3). */
export function unitForClass(cls: UnitClass, age: number): UnitId | null {
  switch (cls) {
    case 'spear':
      return 'spearman';
    case 'sword':
      return 'swordsman';
    case 'archer':
      return 'archer';
    case 'horse':
      return age >= 3 ? 'cataphract' : 'horseman';
    case 'heavyCav':
      return 'cataphract';
    default:
      return null;
  }
}

/** Military upgrade lines by the building that researches them. */
export const UPGRADE_LINE: Readonly<Record<string, 'infantry' | 'archer' | 'cavalry'>> = {
  barracks: 'infantry',
  archeryRange: 'archer',
  stable: 'cavalry',
};

const RESOURCE_SHARES_HARD: Record<number, Record<ResourceType, number>> = {
  1: { food: 0.8, wood: 0.2, gold: 0, stone: 0 },
  2: { food: 0.55, wood: 0.35, gold: 0.1, stone: 0 },
  3: { food: 0.5, wood: 0.27, gold: 0.18, stone: 0.05 },
  4: { food: 0.45, wood: 0.25, gold: 0.22, stone: 0.08 },
};

const RESOURCE_SHARES_STANDARD: Record<number, Record<ResourceType, number>> = {
  1: { food: 0.8, wood: 0.2, gold: 0, stone: 0 },
  2: { food: 0.55, wood: 0.28, gold: 0.17, stone: 0 },
  3: { food: 0.4, wood: 0.18, gold: 0.27, stone: 0.15 },
  4: { food: 0.4, wood: 0.18, gold: 0.27, stone: 0.15 },
};

export const DIFFICULTY: Readonly<Record<AiDifficulty, DifficultyProfile>> = {
  easy: {
    id: 'easy',
    decisionInterval: 60,
    villagerTarget: 28,
    firstBarracks: { villagers: 16, seconds: 6.5 * 60 },
    militaryBuildings: [{ age: 2, type: 'archeryRange', count: 1 }],
    armyShare: 0.2,
    wave: { earliest: 15 * 60, jitter: 60, forcedAfter: 3 * 60, sizes: [4, 6, 8], growth: 1, cap: 10, reinforceFromWave: null, interval: 4 * 60 },
    counterWeight: 0,
    fixed: { spear: 0.6, archer: 0.4 },
    upgrades: 'none',
    upgradesFromAge: 5,
    siege: { rams: 0, trebuchets: 0, siphonarioi: 0 },
    maxAge: 3,
    target: 'nearest',
    retreatBelow: null,
    reactionDelay: 10,
    villagers: 'none',
    repair: false,
    rebuild: 'housesAndCenter',
    allIn: null,
    plan: {
      ...PLAN,
      villagerTarget: 28,
      maxAge: 3,
      tcQueueDepth: 1,
      holdSeconds: { 1: 0, 2: 30, 3: 30 },
      shares: { ...PLAN.shares, 1: { food: 0.6, wood: 0.4, gold: 0, stone: 0 } },
    },
  },
  standard: {
    id: 'standard',
    decisionInterval: 20,
    villagerTarget: 50,
    firstBarracks: { villagers: 14, seconds: null },
    militaryBuildings: [
      { age: 2, type: 'archeryRange', count: 1 },
      { age: 2, type: 'stable', count: 1 },
    ],
    armyShare: 0.35,
    wave: { earliest: 10 * 60, jitter: 30, forcedAfter: 90, sizes: [10, 14], growth: 4, cap: 30, reinforceFromWave: null, interval: 3 * 60 },
    counterWeight: 0.5,
    fixed: { sword: 0.35, archer: 0.3, horse: 0.2, spear: 0.15 },
    upgrades: 'topTwoLevelOne',
    upgradesFromAge: 3,
    siege: { rams: 2, trebuchets: 0, siphonarioi: 0 },
    maxAge: 4,
    target: 'priority',
    retreatBelow: 0.3,
    reactionDelay: 3,
    villagers: 'evacuate',
    repair: true,
    rebuild: 'desired',
    allIn: 45 * 60,
    plan: {
      ...PLAN,
      villagerTarget: 50,
      shares: RESOURCE_SHARES_STANDARD,
      houseMargin: 4,
      holdSeconds: { 1: 50, 2: 30, 3: 30 },
    },
  },
  hard: {
    id: 'hard',
    decisionInterval: 10,
    villagerTarget: 70,
    firstBarracks: { villagers: 10, seconds: null },
    militaryBuildings: [
      { age: 2, type: 'archeryRange', count: 1 },
      { age: 2, type: 'stable', count: 1 },
      { age: 2, type: 'barracks', count: 2 },
    ],
    armyShare: 0.45,
    wave: { earliest: 7 * 60, jitter: 20, forcedAfter: 70, sizes: [8, 16], growth: 6, cap: 36, reinforceFromWave: null, interval: 90 },
    counterWeight: 1,
    fixed: { sword: 0.35, archer: 0.3, horse: 0.2, spear: 0.15 },
    upgrades: 'all',
    upgradesFromAge: 2,
    siege: { rams: 2, trebuchets: 1, siphonarioi: 3 },
    maxAge: 4,
    target: 'armyAware',
    retreatBelow: 0.4,
    reactionDelay: 1,
    villagers: 'fightSmall',
    repair: true,
    rebuild: 'all',
    allIn: 40 * 60,
    plan: {
      ...PLAN,
      villagerTarget: 70,
      villagerCapByAge: { 1: 14 },
      shares: RESOURCE_SHARES_HARD,
      houseMargin: 5,
      holdSeconds: { 1: 70, 2: 30, 3: 30 },
    },
  },
};

/** Launch threshold for wave number `n` (1-based). */
export function waveThreshold(w: WaveSchedule, n: number): number {
  const last = w.sizes[w.sizes.length - 1] ?? 4;
  if (n <= w.sizes.length) return w.sizes[n - 1] ?? last;
  return Math.min(w.cap, last + w.growth * (n - w.sizes.length));
}
