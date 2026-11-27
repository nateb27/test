/**
 * Save format v2 (PLAN-M2 2.8, 3.6): canonical JSON of `{ version: 2, state, controllers }`.
 * Owned by WP1 (versioning and validation hardened by WP12); in M2 by WP20, then the orchestrator.
 *
 * Only GameState (plus the AI controllers' own memory, beside it) is saved. Everything derived from the state
 * (occupancy grid, resolved stat tables and combat profiles, the spatial index, the path component cache, the movement
 * spatial hash) is rebuilt on load by `simFromState` -> `rebuildRuntime`. `hashState` covers the state only.
 *
 * Changing the shape or meaning of GameState means bumping `SAVE_VERSION`
 * (src/sim/types.ts) and, if old saves should keep loading, adding a function
 * to `MIGRATIONS` that turns a version-N state into a version-(N+1) state.
 * Committed saves: `tests/sim/fixtures/save-v1.json` (must keep loading through the migration; its re-serialised
 * form is `save-v1-as-v2.json`) and `save-v2.json` (must round-trip byte for byte).
 */

import { registry } from '../data/index';
import type { DataRegistry } from '../data/schema';
import { canonicalJson } from './hash';
import { simFromState } from './sim';
import {
  AI_DIFFICULTIES,
  MAX_PRODUCTION_QUEUE,
  PROJECTILE_KINDS,
  SAVE_VERSION,
  STANCES,
  type AiDifficulty,
  type GameState,
  type JsonValue,
  type PlayerId,
  type Sim,
} from './types';

/** What an AI controller saves beside the state (`controller.save()`, PLAN-M2 2.7). */
export interface ControllerSave {
  playerId: PlayerId;
  kind: 'ai';
  difficulty: AiDifficulty;
  memory: JsonValue;
}

/** A loaded save file: the sim plus the controllers to rebuild (empty for v1 files). */
export interface LoadedSave {
  sim: Sim;
  controllers: ControllerSave[];
}

interface SaveFile {
  version: number;
  state: GameState;
  controllers: ControllerSave[];
}

export type SaveErrorCode =
  /** Not JSON at all. */
  | 'invalidJson'
  /** JSON, but not a save file (no version or state). */
  | 'notASave'
  /** A save file of another format version that cannot be migrated. */
  | 'unsupportedVersion'
  /** The right version, but the state is damaged or refers to content that does not exist. */
  | 'corrupt';

/** Every reason `deserialize` refuses a file. `code` says which; `message` is plain English. */
export class SaveError extends Error {
  constructor(
    readonly code: SaveErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SaveError';
  }
}

/** The save's `version` is not one this build can read. */
export class SaveVersionError extends SaveError {
  /** How the save's version compares with `SAVE_VERSION`. `unknown` when it is not an integer. */
  readonly direction: 'newer' | 'older' | 'unknown';

  constructor(
    /** The `version` found in the file, as written. */
    readonly found: unknown,
    /** The version this build reads (`SAVE_VERSION`). */
    readonly expected: number,
  ) {
    super(
      'unsupportedVersion',
      typeof found !== 'number'
        ? `Unrecognised save version: ${JSON.stringify(found)} is not a number (this build reads version ${expected})`
        : !Number.isInteger(found)
          ? `Unrecognised save version: ${String(found)} is not a whole number (this build reads version ${expected})`
          : `Unsupported save version: ${found} (expected ${expected})`,
    );
    this.name = 'SaveVersionError';
    this.direction =
      typeof found !== 'number' || !Number.isInteger(found) ? 'unknown' : found > expected ? 'newer' : 'older';
  }
}

type Migration = (state: Record<string, unknown>, data: DataRegistry) => Record<string, unknown>;

/**
 * Upgrade steps: `MIGRATIONS[n]` turns the state of a version-n save into the
 * state of a version-(n+1) save. A step may assume nothing about a damaged file: anything it throws becomes
 * `SaveError('corrupt')`, and the result is validated like any current save.
 */
const MIGRATIONS: Readonly<Record<number, Migration>> = {
  1: migrateV1toV2,
};

/**
 * v1 -> v2 (PLAN-M2 3.6): projectiles, match (sandbox), player identity/outcome/stats, unit and building combat
 * state. Objectives are unchanged; controllers start empty (set by the caller).
 */
function migrateV1toV2(state: Record<string, unknown>, data: DataRegistry): Record<string, unknown> {
  const tick = state.tick as number;
  state.projectiles = [];
  state.nextProjectileId = 1;
  state.match = { mode: 'sandbox', winner: null, endedTick: null };
  for (const p of state.players as Record<string, unknown>[]) {
    const id = p.id as number;
    const age = p.age as number;
    p.name = id === 0 ? 'Neutral' : id === 1 ? 'Player' : `Player ${id}`;
    p.controller = id === 0 ? 'neutral' : 'human';
    p.difficulty = null;
    p.outcome = 'playing';
    p.defeatedTick = null;
    p.alert = null;
    p.stats = {
      unitsTrained: 0,
      unitsLost: 0,
      unitsKilled: 0,
      buildingsBuilt: 0,
      buildingsLost: 0,
      buildingsDestroyed: 0,
      resourcesGathered: { food: 0, wood: 0, gold: 0, stone: 0 },
      techsResearched: 0,
      peakPopulation: p.popUsed,
      // The tick an age was reached is unknown in v1: reached ages are approximated by the save's tick.
      ageReachedTick: [0, age >= 2 ? tick : null, age >= 3 ? tick : null, age >= 4 ? tick : null],
    };
  }
  const s = data.combat.constructionStartPercent;
  for (const e of state.entities as Record<string, unknown>[]) {
    const id = e.id as number;
    const def = data.def(e.typeId as string);
    if (e.kind === 'unit') {
      e.hp = def !== undefined && def.kind === 'unit' ? def.combat.hp : 1; // no hp modifiers exist in v1 data
      e.stance = 'aggressive';
      e.combat = { cooldown: 0, windup: 0, swingTargetId: null, nextScanTick: tick + (id % 10), lastAttackTick: null };
      e.lastAttackerId = null;
      e.lastDamagedTick = null;
    } else if (e.kind === 'building') {
      const building = def !== undefined && def.kind === 'building' ? def : undefined;
      const maxHp = building?.combat.hp ?? 1;
      const progress = e.progress as number;
      const hp = e.constructed === true ? maxHp : Math.max(1, Math.floor((maxHp * (s + (100 - s) * progress)) / 100));
      e.hp = hp;
      e.builtHp = hp;
      e.attack =
        building?.combat.attack !== undefined
          ? { cooldown: 0, targetId: null, nextScanTick: tick + (id % 10), lastAttackTick: null }
          : null;
      e.lastAttackerId = null;
      e.lastDamagedTick = null;
      e.repairerIds = [];
      e.repairAccumulator = 0;
      e.repairCostAccumulator = { food: 0, wood: 0, gold: 0, stone: 0 };
    }
  }
  return state;
}

/**
 * Canonical JSON of a v2 save file: the sim's state (runtime caches are not included) and the controllers' saves
 * (`controller.save()` of each AI, omitted nulls filtered by the caller), sorted by player id.
 */
export function serialize(sim: Sim, controllers: readonly ControllerSave[] = []): string {
  const sorted = [...controllers].sort((a, b) => a.playerId - b.playerId);
  return canonicalJson({ version: SAVE_VERSION, state: sim.state, controllers: sorted });
}

/** Rebuild a Sim from `serialize` output, ignoring any controllers. Throws `SaveError` (or `SaveVersionError`). */
export function deserialize(json: string, data: DataRegistry = registry): Sim {
  return deserializeSave(json, data).sim;
}

/**
 * Rebuild a Sim and the controller saves from a save file (v1 files give `controllers: []` and load as sandbox
 * matches). Throws `SaveError` (or `SaveVersionError`) when the file cannot be used.
 */
export function deserializeSave(json: string, data: DataRegistry = registry): LoadedSave {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new SaveError('invalidJson', 'Not a save file: the text is not valid JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new SaveError('notASave', 'Not a save file');
  }
  const file = parsed as Partial<SaveFile> & Record<string, unknown>;
  if (file.version === undefined || typeof file.state !== 'object' || file.state === null) {
    throw new SaveError('notASave', 'Not a save file');
  }
  let version: unknown = file.version;
  let state = file.state as unknown as Record<string, unknown>;
  const fromVersion = version;
  if (typeof version === 'number' && Number.isInteger(version) && version < SAVE_VERSION) {
    while ((version as number) < SAVE_VERSION) {
      const step = MIGRATIONS[version as number];
      if (step === undefined) throw new SaveVersionError(file.version, SAVE_VERSION);
      try {
        state = step(state, data);
      } catch (e) {
        if (e instanceof SaveError) throw e;
        bad(`it could not be upgraded from version ${String(version)}`);
      }
      version = (version as number) + 1;
    }
  }
  if (version !== SAVE_VERSION) throw new SaveVersionError(file.version, SAVE_VERSION);
  validateState(state, data);
  const controllers = fromVersion === SAVE_VERSION ? validateControllers(file.controllers, state) : [];
  const sim = simFromState(state as unknown as GameState, data);
  validateHp(sim);
  return { sim, controllers };
}

/** Controller saves: an array of `{ playerId, kind: 'ai', difficulty, memory }`, one per AI player id at most. */
function validateControllers(value: unknown, state: Record<string, unknown>): ControllerSave[] {
  if (!Array.isArray(value)) bad('the controller list is missing');
  const players = state.players as Record<string, unknown>[];
  const seen = new Set<number>();
  return (value as unknown[]).map((c, i) => {
    if (!isRecord(c)) bad(`controller ${i} is invalid`);
    const save = c as Record<string, unknown>;
    if (!isInt(save.playerId, 1) || save.playerId >= players.length || seen.has(save.playerId)) {
      bad(`controller ${i} has an invalid player`);
    }
    seen.add(save.playerId as number);
    if (save.kind !== 'ai' || !AI_DIFFICULTIES.includes(save.difficulty as AiDifficulty)) bad(`controller ${i} is of an unknown kind`);
    if (!('memory' in save)) bad(`controller ${i} has no memory`);
    return { playerId: save.playerId as number, kind: 'ai', difficulty: save.difficulty as AiDifficulty, memory: save.memory as JsonValue };
  });
}

/** hp (and builtHp) within 0..resolved max, checked once the runtime exists. */
function validateHp(sim: Sim): void {
  for (const e of sim.state.entities) {
    if (e.kind === 'node') continue;
    const max = sim.query.resolvedStat(e.owner, e.typeId, 'hp');
    if (e.hp > max) bad(`${e.kind} ${e.id} has more hit points than it can have`);
    if (e.kind === 'building' && (e.builtHp < 1 || e.builtHp > max)) bad(`building ${e.id} has invalid construction hit points`);
  }
}

// ---------------------------------------------------------------------------
// Validation: enough to refuse a damaged or hand-edited save cleanly instead of
// crashing mid-game: shapes and ranges of every field the sim reads, ids that
// must name a def of the right kind, positions and footprints inside the map,
// and references to entity ids that do not exist (except in orders, see `validOrder`). Whether an order still makes
// sense (a path that no longer leads anywhere, ...) is left to the sim.
// ---------------------------------------------------------------------------

function bad(what: string): never {
  throw new SaveError('corrupt', `This save is damaged: ${what}`);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isInt(v: unknown, min = 0): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min;
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isIntOrNull(v: unknown): boolean {
  return v === null || isInt(v);
}

function validateStats(v: unknown): boolean {
  if (!isRecord(v)) return false;
  const counters = ['unitsTrained', 'unitsLost', 'unitsKilled', 'buildingsBuilt', 'buildingsLost', 'buildingsDestroyed', 'techsResearched', 'peakPopulation'];
  if (!counters.every((k) => isInt(v[k]))) return false;
  if (!validResources(v.resourcesGathered)) return false;
  const ages = v.ageReachedTick;
  return Array.isArray(ages) && ages.length === 4 && ages.every(isIntOrNull);
}

function validatePlayerM2(player: Record<string, unknown>, i: number): void {
  if (typeof player.name !== 'string') bad(`player ${i} has no name`);
  if (!isInt(player.color) || (player.color as number) > 0xffffff) bad(`player ${i} has an invalid colour`);
  const controller = player.controller;
  if (controller !== (i === 0 ? 'neutral' : 'human') && !(i > 0 && controller === 'ai')) bad(`player ${i} has an invalid controller`);
  if (player.difficulty !== null && !AI_DIFFICULTIES.includes(player.difficulty as AiDifficulty)) bad(`player ${i} has an invalid difficulty`);
  if (!['playing', 'won', 'defeated'].includes(player.outcome as string)) bad(`player ${i} has an invalid outcome`);
  if (!isIntOrNull(player.defeatedTick)) bad(`player ${i} has an invalid defeat tick`);
  if (!validateStats(player.stats)) bad(`player ${i} has invalid statistics`);
  const alert = player.alert;
  if (alert !== null && (!isRecord(alert) || !isInt(alert.tick) || !isNum(alert.x) || !isNum(alert.y))) bad(`player ${i} has an invalid alert`);
}

function validateState(state: Record<string, unknown>, data: DataRegistry): void {
  for (const key of ['tick', 'seed', 'mapSeed', 'nextEntityId', 'occupancyVersion', 'nextPathRequestId', 'nextProjectileId']) {
    if (!isInt(state[key])) bad(`"${key}" is not a whole number`);
  }
  const rng = state.rng;
  if (!isRecord(rng) || !['a', 'b', 'c', 'd'].every((k) => isInt(rng[k]))) bad('the random generator state is missing');

  const map = state.map;
  if (!isRecord(map) || !isInt(map.width, 1) || !isInt(map.height, 1) || map.width > 1024 || map.height > 1024) {
    bad('the map size is invalid');
  }
  const { width, height, tiles } = map as { width: number; height: number; tiles: unknown };
  if (!Array.isArray(tiles) || tiles.length !== width * height || !tiles.every((t) => typeof t === 'string')) {
    bad('the map tiles do not match the map size');
  }

  const players = state.players;
  if (!Array.isArray(players) || players.length < 1) bad('there are no players');
  (players as unknown[]).forEach((p, i) => {
    if (!isRecord(p) || p.id !== i) bad(`player ${i} is invalid`);
    const player = p as Record<string, unknown>;
    const res = player.resources;
    if (!isRecord(res) || !['food', 'wood', 'gold', 'stone'].every((k) => isInt(res[k]))) bad(`player ${i} has invalid resources`);
    if (![1, 2, 3, 4].includes(player.age as number)) bad(`player ${i} has an invalid age`);
    if (!isInt(player.popUsed) || !isInt(player.popCap)) bad(`player ${i} has invalid population`);
    if (!Array.isArray(player.researched) || !player.researched.every((t) => typeof t === 'string')) bad(`player ${i} has invalid research`);
    if (!isRecord(player.cheats)) bad(`player ${i} has no cheat flags`);
    if (player.civ !== null && (typeof player.civ !== 'string' || !data.civs.some((c) => c.id === player.civ))) {
      bad(`player ${i} has an unknown civilization`);
    }
    validatePlayerM2(player, i);
  });
  const playerTotal = (players as unknown[]).length;

  const match = state.match;
  if (!isRecord(match) || (match.mode !== 'sandbox' && match.mode !== 'conquest')) bad('the match mode is missing');
  const m = match as Record<string, unknown>;
  if (m.winner !== null && (!isInt(m.winner, 1) || (m.winner as number) >= playerTotal)) bad('the match winner is not a player');
  if (!isIntOrNull(m.endedTick)) bad('the match end tick is invalid');

  if (!Array.isArray(state.pathQueue)) bad('the path queue is missing');
  if (!isRecord(state.objectives) || !Array.isArray(state.objectives.entries)) bad('the objectives are missing');
  for (const [i, o] of (state.objectives.entries as unknown[]).entries()) {
    if (!isRecord(o) || typeof o.id !== 'string' || !isInt(o.playerId) || !isIntOrNull(o.completedTick)) bad(`objective ${i} is invalid`);
    const entry = o as Record<string, unknown>;
    const okKind =
      (entry.kind === 'reachAge' && [1, 2, 3, 4].includes(entry.targetAge as number)) ||
      (entry.kind === 'conquest' && entry.targetAge === null);
    if (!okKind) bad(`objective ${i} has an invalid kind`);
  }

  const entities = state.entities;
  if (!Array.isArray(entities)) bad('the entity list is missing');
  const playerCount = (players as unknown[]).length;
  const ids = new Set<number>();
  const unitIds = new Set<number>();
  for (const e of entities as unknown[]) {
    if (isRecord(e) && typeof e.id === 'number') {
      ids.add(e.id);
      if (e.kind === 'unit') unitIds.add(e.id);
    }
  }
  const ctx: Ctx = { data, width, height, ids, unitIds };

  let last = 0;
  for (const e of entities as unknown[]) {
    if (!isRecord(e) || !isInt(e.id, 1) || e.id <= last || e.id >= (state.nextEntityId as number)) {
      bad('entity ids are not unique and ascending');
    }
    const entity = e as Record<string, unknown>;
    last = entity.id as number;
    if (!isInt(entity.owner) || (entity.owner as number) >= playerCount) bad(`entity ${last} has an invalid owner`);
    if (typeof entity.typeId !== 'string') bad(`entity ${last} has no type`);
    const def = data.def(entity.typeId as string);
    if (def === undefined) bad(`entity ${last} is a "${String(entity.typeId)}", which does not exist in this version`);
    if (entity.kind !== def?.kind) bad(`entity ${last} has the wrong kind for "${String(entity.typeId)}"`);
    if (entity.kind === 'unit') {
      validateUnit(entity, last, ctx);
    } else {
      validateStatic(entity, last, ctx);
    }
  }

  const projectiles = state.projectiles;
  if (!Array.isArray(projectiles)) bad('the projectile list is missing');
  let lastProjectile = 0;
  for (const p of projectiles as unknown[]) {
    if (!isRecord(p) || !isInt(p.id, 1) || p.id <= lastProjectile || p.id >= (state.nextProjectileId as number)) {
      bad('projectile ids are not unique and ascending');
    }
    const pr = p as Record<string, unknown>;
    lastProjectile = pr.id as number;
    const what = `projectile ${lastProjectile}`;
    if (!PROJECTILE_KINDS.includes(pr.kind as never)) bad(`${what} is of an unknown kind`);
    if (!isInt(pr.owner) || (pr.owner as number) >= playerTotal) bad(`${what} has an invalid owner`);
    if (!isInt(pr.sourceId, 1) || !isInt(pr.targetId, 1)) bad(`${what} has invalid references`);
    const source = typeof pr.sourceType === 'string' ? data.def(pr.sourceType) : undefined;
    if (source === undefined || (source.kind !== 'unit' && source.kind !== 'building')) bad(`${what} has an unknown source`);
    if (!isFiniteVec(pr.from) || !isFiniteVec(pr.to)) bad(`${what} has an invalid position`);
    if (!isInt(pr.flightTicks, 1) || !isInt(pr.ticksLeft, 1) || (pr.ticksLeft as number) > (pr.flightTicks as number)) {
      bad(`${what} has an invalid flight time`);
    }
    if (!isInt(pr.damage, 1)) bad(`${what} has invalid damage`);
  }

  for (const [i, r] of (state.pathQueue as unknown[]).entries()) {
    if (!isRecord(r) || !isInt(r.id) || !isInt(r.unitId, 1) || !ids.has(r.unitId)) bad(`path request ${i} is invalid`);
    const req = r as Record<string, unknown>;
    if (!isRecord(req.from) || !isInt(req.from.tx) || !isInt(req.from.ty)) bad(`path request ${i} has an invalid start`);
    const goal = req.goal;
    if (!isRecord(goal) || (goal.kind !== 'point' && goal.kind !== 'footprint')) bad(`path request ${i} has an invalid goal`);
  }
}

interface Ctx {
  /** Ids of every entity, and of the units among them. */
  unitIds: ReadonlySet<number>;
  data: DataRegistry;
  width: number;
  height: number;
  ids: ReadonlySet<number>;
}

function isFiniteVec(v: unknown): boolean {
  return isRecord(v) && isNum(v.x) && isNum(v.y);
}

function isVec(v: unknown, ctx: Ctx): boolean {
  return isRecord(v) && isNum(v.x) && isNum(v.y) && v.x >= 0 && v.y >= 0 && v.x <= ctx.width && v.y <= ctx.height;
}

function validResources(v: unknown): boolean {
  return isRecord(v) && ['food', 'wood', 'gold', 'stone'].every((k) => isInt(v[k]));
}

function refExists(id: unknown, ctx: Ctx): boolean {
  return isInt(id, 1) && ctx.ids.has(id);
}

function validOrder(o: unknown, ctx: Ctx): boolean {
  if (!isRecord(o)) return false;
  switch (o.type) {
    case 'move':
      return isVec(o, ctx);
    // The target must be a plausible id, but need not exist: a node depleted or a building deleted this tick is only
    // dropped from orders when the order next runs, so a save between ticks can legitimately hold such an order.
    case 'gather':
      return isInt(o.targetId, 1);
    case 'build':
    case 'assist':
    case 'dropOff':
    case 'repair':
      return isInt(o.buildingId, 1);
    case 'attack':
      return isInt(o.targetId, 1) && typeof o.auto === 'boolean';
    case 'attackMove':
      return isVec(o, ctx);
    case 'hold':
      return true;
    default:
      return false;
  }
}

/** M2 fields shared by units and buildings: hp, attacker, damage tick. */
function validateCombatCommon(entity: Record<string, unknown>, what: string): void {
  if (!isInt(entity.hp)) bad(`${what} has invalid hit points`);
  if (entity.lastAttackerId !== null && !isInt(entity.lastAttackerId, 1)) bad(`${what} has an invalid attacker`);
  if (!isIntOrNull(entity.lastDamagedTick)) bad(`${what} has an invalid damage tick`);
}

function validateUnitCombat(entity: Record<string, unknown>, id: number): void {
  const what = `unit ${id}`;
  validateCombatCommon(entity, what);
  if (!STANCES.includes(entity.stance as never)) bad(`${what} has an invalid stance`);
  const c = entity.combat;
  if (!isRecord(c) || !isInt(c.cooldown) || !isInt(c.windup) || !isInt(c.nextScanTick) || !isIntOrNull(c.lastAttackTick)) {
    bad(`${what} has an invalid combat state`);
  }
  const swing = (c as Record<string, unknown>).swingTargetId;
  if (swing !== null && !isInt(swing, 1)) bad(`${what} has an invalid combat state`);
}

function validateBuildingCombat(entity: Record<string, unknown>, id: number, ctx: Ctx): void {
  const what = `building ${id}`;
  validateCombatCommon(entity, what);
  if (!isInt(entity.builtHp, 1)) bad(`${what} has invalid construction hit points`);
  const hasAttack = ctx.data.building(entity.typeId as string).combat.attack !== undefined;
  const a = entity.attack;
  if (hasAttack) {
    if (!isRecord(a) || !isInt(a.cooldown) || !isInt(a.nextScanTick) || !isIntOrNull(a.lastAttackTick) || (a.targetId !== null && !isInt(a.targetId, 1))) {
      bad(`${what} has an invalid attack state`);
    }
  } else if (a !== null) {
    bad(`${what} has an attack state but cannot attack`);
  }
  if (!Array.isArray(entity.repairerIds) || !entity.repairerIds.every((r) => isInt(r, 1) && ctx.unitIds.has(r))) {
    bad(`${what} has an invalid repairer list`);
  }
  if (!isNum(entity.repairAccumulator) || (entity.repairAccumulator as number) < 0) bad(`${what} has an invalid repair accumulator`);
  const acc = entity.repairCostAccumulator;
  if (!isRecord(acc) || !['food', 'wood', 'gold', 'stone'].every((k) => isNum(acc[k]) && (acc[k] as number) >= 0)) {
    bad(`${what} has an invalid repair cost accumulator`);
  }
}

function validateUnit(entity: Record<string, unknown>, id: number, ctx: Ctx): void {
  if (!isVec(entity.pos, ctx) || !isVec(entity.prevPos, ctx)) bad(`unit ${id} has a position outside the map`);
  if (!isInt(entity.facing) || (entity.facing as number) > 7) bad(`unit ${id} has an invalid facing`);
  if (!Array.isArray(entity.orderQueue) || !entity.orderQueue.every((o) => validOrder(o, ctx))) {
    bad(`unit ${id} has an invalid order queue`);
  }
  const cur = entity.currentOrder;
  if (cur !== null && !validOrder(cur, ctx)) bad(`unit ${id} has an invalid order`);
  if (cur !== null && typeof (cur as Record<string, unknown>).phase !== 'string') bad(`unit ${id} has an order with no phase`);
  const carried = entity.carried;
  if (carried !== null) {
    if (!isRecord(carried) || !['food', 'wood', 'gold', 'stone'].includes(carried.type as string) || !isInt(carried.amount, 1)) {
      bad(`unit ${id} carries an invalid load`);
    }
  }
  const path = entity.path;
  if (path !== null) {
    if (!isRecord(path) || !Array.isArray(path.waypoints) || !path.waypoints.every((w) => isVec(w, ctx)) || !isInt(path.nextIndex) || !isInt(path.occupancyVersion)) {
      bad(`unit ${id} has an invalid path`);
    }
  }
  if (entity.pendingPathRequestId !== null && !isInt(entity.pendingPathRequestId)) bad(`unit ${id} has an invalid path request`);
  validateUnitCombat(entity, id);
}

function validateStatic(entity: Record<string, unknown>, id: number, ctx: Ctx): void {
  const { data, width, height } = ctx;
  const tile = entity.tile;
  if (!isRecord(tile) || !isInt(tile.tx) || !isInt(tile.ty)) bad(`entity ${id} has an invalid tile`);
  const t = tile as { tx: number; ty: number };
  const typeId = entity.typeId as string;
  const size = entity.kind === 'node' ? data.node(typeId).footprint : data.building(typeId).footprint;
  if (t.tx + size > width || t.ty + size > height) bad(`entity ${id} stands outside the map`);
  if (!Array.isArray(entity.gathererIds) || !entity.gathererIds.every((g) => refExists(g, ctx))) {
    bad(`entity ${id} has an invalid gatherer list`);
  }
  if (entity.kind === 'node') {
    if (!isInt(entity.amount)) bad(`node ${id} has an invalid amount`);
    return;
  }
  if (!Array.isArray(entity.queue) || !Array.isArray(entity.builderIds)) bad(`building ${id} has no queue`);
  if (!(entity.builderIds as unknown[]).every((b) => refExists(b, ctx))) bad(`building ${id} has an invalid builder list`);
  if (typeof entity.constructed !== 'boolean' || !isNum(entity.progress) || entity.progress < 0 || entity.progress > 1) {
    bad(`building ${id} has invalid progress`);
  }
  if (!isNum(entity.incomeAccumulator)) bad(`building ${id} has an invalid income accumulator`);
  validateBuildingCombat(entity, id, ctx);
  if (!validResources(entity.costPaid)) bad(`building ${id} has an invalid cost record`);
  const rally = entity.rally;
  if (rally !== null) {
    if (!isVec(rally, ctx) || (isRecord(rally) && rally.targetId !== null && !refExists(rally.targetId, ctx))) {
      bad(`building ${id} has an invalid rally point`);
    }
  }
  const queue = entity.queue as unknown[];
  if (queue.length > MAX_PRODUCTION_QUEUE) bad(`building ${id} has too many queued items`);
  queue.forEach((item, n) => {
    const what = `queue item ${n + 1} of building ${id}`;
    if (!isRecord(item)) bad(`${what} is invalid`);
    const it = item as Record<string, unknown>;
    if (it.kind === 'unit') {
      if (typeof it.unitType !== 'string' || data.def(it.unitType)?.kind !== 'unit') bad(`${what} is not a known unit`);
      if (typeof it.popCapNotified !== 'boolean') bad(`${what} is invalid`);
    } else if (it.kind === 'tech') {
      if (typeof it.techId !== 'string' || data.def(it.techId)?.kind !== 'tech') bad(`${what} is not a known technology`);
    } else {
      bad(`${what} is neither a unit nor a technology`);
    }
    if (!validResources(it.costPaid)) bad(`${what} has an invalid cost`);
    if (!isInt(it.ticksDone) || !isInt(it.ticksTotal, 1) || (it.ticksDone as number) > (it.ticksTotal as number)) {
      bad(`${what} has invalid progress`);
    }
  });
}
