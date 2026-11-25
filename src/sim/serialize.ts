/**
 * Save format: canonical JSON of `{ version: SAVE_VERSION, state }`.
 * Owned by WP1 (versioning and validation hardened by WP12).
 *
 * Only GameState is saved. Everything derived from it (occupancy grid,
 * resolved stat tables, the path component cache, the movement spatial hash)
 * is rebuilt from state on load by `simFromState` -> `rebuildRuntime`.
 *
 * Changing the shape or meaning of GameState means bumping `SAVE_VERSION`
 * (src/sim/types.ts) and, if old saves should keep loading, adding a function
 * to `MIGRATIONS` that turns a version-N state into a version-(N+1) state.
 * `tests/sim/fixtures/save-v1.json` is a committed save: the test that loads
 * it fails when the format changes without a version bump or migration.
 */

import { registry } from '../data/index';
import type { DataRegistry } from '../data/schema';
import { canonicalJson } from './hash';
import { simFromState } from './sim';
import { MAX_PRODUCTION_QUEUE, SAVE_VERSION, type GameState, type Sim } from './types';

interface SaveFile {
  version: number;
  state: GameState;
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

/**
 * Upgrade steps: `MIGRATIONS[n]` turns the state of a version-n save into the
 * state of a version-(n+1) save. Empty while the format is at version 1.
 */
const MIGRATIONS: Readonly<Record<number, (state: Record<string, unknown>) => Record<string, unknown>>> = {};

/** Canonical JSON of the sim's state. Runtime caches are not included. */
export function serialize(sim: Sim): string {
  return canonicalJson({ version: SAVE_VERSION, state: sim.state });
}

/** Rebuild a Sim from `serialize` output. Throws `SaveError` (or `SaveVersionError`) when the file cannot be used. */
export function deserialize(json: string, data: DataRegistry = registry): Sim {
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
  if (typeof version === 'number' && Number.isInteger(version) && version < SAVE_VERSION) {
    while ((version as number) < SAVE_VERSION) {
      const step = MIGRATIONS[version as number];
      if (step === undefined) throw new SaveVersionError(file.version, SAVE_VERSION);
      state = step(state);
      version = (version as number) + 1;
    }
  }
  if (version !== SAVE_VERSION) throw new SaveVersionError(file.version, SAVE_VERSION);
  validateState(state, data);
  return simFromState(state as unknown as GameState, data);
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

function validateState(state: Record<string, unknown>, data: DataRegistry): void {
  for (const key of ['tick', 'seed', 'mapSeed', 'nextEntityId', 'occupancyVersion', 'nextPathRequestId']) {
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
  });

  if (!Array.isArray(state.pathQueue)) bad('the path queue is missing');
  if (!isRecord(state.objectives) || !Array.isArray(state.objectives.entries)) bad('the objectives are missing');

  const entities = state.entities;
  if (!Array.isArray(entities)) bad('the entity list is missing');
  const playerCount = (players as unknown[]).length;
  const ids = new Set<number>();
  for (const e of entities as unknown[]) if (isRecord(e) && typeof e.id === 'number') ids.add(e.id);
  const ctx: Ctx = { data, width, height, ids };

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

  for (const [i, r] of (state.pathQueue as unknown[]).entries()) {
    if (!isRecord(r) || !isInt(r.id) || !isInt(r.unitId, 1) || !ids.has(r.unitId)) bad(`path request ${i} is invalid`);
    const req = r as Record<string, unknown>;
    if (!isRecord(req.from) || !isInt(req.from.tx) || !isInt(req.from.ty)) bad(`path request ${i} has an invalid start`);
    const goal = req.goal;
    if (!isRecord(goal) || (goal.kind !== 'point' && goal.kind !== 'footprint')) bad(`path request ${i} has an invalid goal`);
  }
}

interface Ctx {
  data: DataRegistry;
  width: number;
  height: number;
  ids: ReadonlySet<number>;
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
      return isInt(o.buildingId, 1);
    default:
      return false;
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
