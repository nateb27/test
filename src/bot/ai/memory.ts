/**
 * AI memory (PLAN-M2 6.2): everything the AI remembers between decisions, as plain JSON. It is saved beside the state
 * through `ControllerSave.memory` and restored exactly. Persistent collections are arrays sorted ascending; no Map or
 * Set outlives a decision. Validation is strict: a damaged memory block makes the save `corrupt`.
 */

import { SaveError, createRng, type JsonValue, type ResourceAmounts, type RngState } from '../../sim';

export type WavePhase = 'massing' | 'attacking' | 'retreating';

export interface WaveMemory {
  /** Wave units, ascending ids (pruned as they die). */
  unitIds: number[];
  /** Current target entity (building or unit), or null before the first choice. */
  targetId: number | null;
  /** The point the wave was last sent to (approach point of the target). */
  orderX: number;
  orderY: number;
  launchTick: number;
  startPower: number;
  /** Tick the retreat began (retreating phase only). */
  retreatTick: number | null;
}

export interface DefenceMemory {
  active: boolean;
  /** Centroid of the threat being answered. */
  x: number;
  y: number;
  /** Tick the current threat was first seen (reaction delay), or null. */
  sinceTick: number | null;
  /** Last tick any threat was seen. */
  lastSeenTick: number | null;
  /** Own fighting units sent to the threat, ascending. */
  defenderIds: number[];
  /** Villagers sent away from the threat or to fight it, ascending; held off the economy until the threat clears. */
  villagerIds: number[];
  /** Whether the wave was recalled for this threat. */
  recalled: boolean;
}

export interface AiMemory {
  version: 1;
  rng: RngState;
  /** Next command seq. */
  seq: number;
  decisions: number;
  phase: WavePhase;
  waveNumber: number;
  nextWaveEarliestTick: number;
  nextWaveForcedTick: number;
  wave: WaveMemory | null;
  defence: DefenceMemory;
  /** Buildings the AI wants standing (most it ever completed per type), sorted by type. */
  desiredBuildings: { type: string; count: number }[];
  /** Tick of the first wave launch (tests, debug), or null. */
  firstWaveTick: number | null;
  /** Tick the all-in began, or null. */
  allInTick: number | null;
  /** Army bank (6.4): the army share of income not yet spent, per resource; integers. */
  bank: ResourceAmounts;
  /** Remainders (in hundredths) of the integer bank credit, per resource. */
  bankRemainder: ResourceAmounts;
  /** `stats.resourcesGathered` at the previous decision. */
  gatheredSeen: ResourceAmounts;
  /** Units ordered per upgrade line (standard upgrades its two most-built lines). */
  trained: { infantry: number; archer: number; cavalry: number };
  /** Centre of the first Town Center (where a lost one is rebuilt). */
  homeX: number;
  homeY: number;
}

/**
 * Seed of the AI's own stream (6.2): `(seed ^ (playerId * 0x9e3779b9)) >>> 0`. The product is exact in a double for
 * any player id below 2^21, and `^` reduces it modulo 2^32, so this is the same on every engine.
 */
export function aiSeed(seed: number, playerId: number): number {
  return ((seed >>> 0) ^ (playerId * 0x9e3779b9)) >>> 0;
}

const ZERO: ResourceAmounts = { food: 0, wood: 0, gold: 0, stone: 0 };

export function initialMemory(seed: number, playerId: number): AiMemory {
  return {
    version: 1,
    rng: createRng(aiSeed(seed, playerId)),
    seq: 1,
    decisions: 0,
    phase: 'massing',
    waveNumber: 0,
    nextWaveEarliestTick: -1,
    nextWaveForcedTick: -1,
    wave: null,
    defence: { active: false, x: 0, y: 0, sinceTick: null, lastSeenTick: null, defenderIds: [], villagerIds: [], recalled: false },
    desiredBuildings: [],
    firstWaveTick: null,
    allInTick: null,
    bank: { ...ZERO },
    bankRemainder: { ...ZERO },
    gatheredSeen: { ...ZERO },
    trained: { infantry: 0, archer: 0, cavalry: 0 },
    homeX: -1,
    homeY: -1,
  };
}

/** Deep copy through JSON (memory is plain JSON by construction). */
export function memoryToJson(mem: AiMemory): JsonValue {
  return JSON.parse(JSON.stringify(mem)) as JsonValue;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function corrupt(what: string): never {
  throw new SaveError('corrupt', `This save is damaged: the AI memory has ${what}`);
}

type Obj = { [key: string]: JsonValue };

function obj(v: JsonValue | undefined, what: string): Obj {
  if (v === null || v === undefined || typeof v !== 'object' || Array.isArray(v)) corrupt(`a bad ${what}`);
  return v;
}

function int(v: JsonValue | undefined, what: string, min = -1): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || Object.is(v, -0)) corrupt(`a bad ${what}`);
  return v;
}

function num(v: JsonValue | undefined, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || Object.is(v, -0)) corrupt(`a bad ${what}`);
  return v;
}

function nullableInt(v: JsonValue | undefined, what: string): number | null {
  return v === null ? null : int(v, what);
}

function idList(v: JsonValue | undefined, what: string): number[] {
  if (!Array.isArray(v)) corrupt(`a bad ${what}`);
  const out: number[] = [];
  let prev = 0;
  for (const x of v) {
    const id = int(x, what, 1);
    if (id <= prev) corrupt(`an unsorted ${what}`);
    prev = id;
    out.push(id);
  }
  return out;
}

function amounts(v: JsonValue | undefined, what: string): ResourceAmounts {
  const o = obj(v, what);
  return { food: int(o.food, what, 0), wood: int(o.wood, what, 0), gold: int(o.gold, what, 0), stone: int(o.stone, what, 0) };
}

function u32(v: JsonValue | undefined): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 0xffffffff) corrupt('a bad rng state');
  return v;
}

/** Parse and check a saved memory block. Throws `SaveError('corrupt')`. */
export function parseMemory(json: JsonValue): AiMemory {
  const o = obj(json, 'memory block');
  if (o.version !== 1) corrupt('an unknown version');
  const r = obj(o.rng, 'rng state');
  const phase = o.phase;
  if (phase !== 'massing' && phase !== 'attacking' && phase !== 'retreating') corrupt('a bad wave phase');
  let wave: WaveMemory | null = null;
  if (o.wave !== null) {
    const w = obj(o.wave, 'wave');
    wave = {
      unitIds: idList(w.unitIds, 'wave unit list'),
      targetId: nullableInt(w.targetId, 'wave target'),
      orderX: num(w.orderX, 'wave point'),
      orderY: num(w.orderY, 'wave point'),
      launchTick: int(w.launchTick, 'wave launch tick'),
      startPower: num(w.startPower, 'wave power'),
      retreatTick: nullableInt(w.retreatTick, 'wave retreat tick'),
    };
  }
  const d = obj(o.defence, 'defence');
  if (typeof d.active !== 'boolean' || typeof d.recalled !== 'boolean') corrupt('a bad defence state');
  const desired = o.desiredBuildings;
  if (!Array.isArray(desired)) corrupt('a bad building list');
  const desiredBuildings = desired.map((e) => {
    const x = obj(e, 'building entry');
    if (typeof x.type !== 'string') corrupt('a bad building entry');
    return { type: x.type, count: int(x.count, 'building count', 0) };
  });
  for (let i = 1; i < desiredBuildings.length; i++) {
    if (desiredBuildings[i - 1]!.type >= desiredBuildings[i]!.type) corrupt('an unsorted building list');
  }
  const t = obj(o.trained, 'trained counts');
  return {
    version: 1,
    rng: { a: u32(r.a), b: u32(r.b), c: u32(r.c), d: u32(r.d) },
    seq: int(o.seq, 'command sequence', 1),
    decisions: int(o.decisions, 'decision count', 0),
    phase,
    waveNumber: int(o.waveNumber, 'wave number', 0),
    nextWaveEarliestTick: int(o.nextWaveEarliestTick, 'wave tick'),
    nextWaveForcedTick: int(o.nextWaveForcedTick, 'wave tick'),
    wave,
    defence: {
      active: d.active,
      x: num(d.x, 'defence point'),
      y: num(d.y, 'defence point'),
      sinceTick: nullableInt(d.sinceTick, 'defence tick'),
      lastSeenTick: nullableInt(d.lastSeenTick, 'defence tick'),
      defenderIds: idList(d.defenderIds, 'defender list'),
      villagerIds: idList(d.villagerIds, 'villager list'),
      recalled: d.recalled,
    },
    desiredBuildings,
    firstWaveTick: nullableInt(o.firstWaveTick, 'first wave tick'),
    allInTick: nullableInt(o.allInTick, 'all-in tick'),
    bank: amounts(o.bank, 'army bank'),
    bankRemainder: amounts(o.bankRemainder, 'army bank'),
    gatheredSeen: amounts(o.gatheredSeen, 'income record'),
    trained: { infantry: int(t.infantry, 'trained count', 0), archer: int(t.archer, 'trained count', 0), cavalry: int(t.cavalry, 'trained count', 0) },
    homeX: num(o.homeX, 'home point'),
    homeY: num(o.homeY, 'home point'),
  };
}
