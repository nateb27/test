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
import { SAVE_VERSION, type GameState, type Sim } from './types';

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
    super('unsupportedVersion', `Unsupported save version: ${String(found)} (expected ${expected})`);
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
// crashing mid-game. Deep consistency (orders pointing at removed entities,
// ...) is left to the sim, whose handlers already tolerate it.
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
      const pos = entity.pos;
      const prev = entity.prevPos;
      if (!isRecord(pos) || !isNum(pos.x) || !isNum(pos.y) || !isRecord(prev) || !isNum(prev.x) || !isNum(prev.y)) {
        bad(`unit ${last} has an invalid position`);
      }
      if (!Array.isArray(entity.orderQueue)) bad(`unit ${last} has no order queue`);
      if (entity.currentOrder !== null && !isRecord(entity.currentOrder)) bad(`unit ${last} has an invalid order`);
    } else {
      const tile = entity.tile;
      if (!isRecord(tile) || !isInt(tile.tx) || !isInt(tile.ty) || tile.tx >= width || tile.ty >= height) {
        bad(`entity ${last} has an invalid tile`);
      }
      if (!Array.isArray(entity.gathererIds)) bad(`entity ${last} has no gatherer list`);
      if (entity.kind === 'node' && !isInt(entity.amount)) bad(`node ${last} has an invalid amount`);
      if (entity.kind === 'building') {
        if (!Array.isArray(entity.queue) || !Array.isArray(entity.builderIds)) bad(`building ${last} has no queue`);
        if (typeof entity.constructed !== 'boolean' || !isNum(entity.progress)) bad(`building ${last} has invalid progress`);
      }
    }
  }
}
