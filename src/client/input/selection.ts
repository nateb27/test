/**
 * Selection logic (client-only state, never in the sim). Everything here is a
 * pure function over entity ids and read-only entities, plus the small
 * `SelectionStore` / `ControlGroups` containers the input controller owns.
 */

import type { DataRegistry } from '../../data/schema';
import type { EntityId, PlayerId, ReadonlyEntity, Vec2 } from '../../sim/types';

export type EntityLookup = (id: EntityId) => ReadonlyEntity | undefined;

function sortedUnique(ids: Iterable<EntityId>): EntityId[] {
  return [...new Set(ids)].sort((a, b) => a - b);
}

function sameIds(a: readonly EntityId[], b: readonly EntityId[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** True when every selected entity is owned by `owner` (a foreign/neutral selection is view-only). */
function allOwn(ids: readonly EntityId[], get: EntityLookup, owner: PlayerId): boolean {
  return ids.every((id) => get(id)?.owner === owner);
}

/**
 * Left click. Own entity: select it (shift toggles it). Foreign entity (a node
 * or an enemy): select it alone for inspection; shift never mixes it in.
 * Empty ground: clear (shift keeps the selection).
 */
export function clickSelection(
  current: readonly EntityId[],
  hit: ReadonlyEntity | null,
  shift: boolean,
  owner: PlayerId,
  get: EntityLookup,
): EntityId[] {
  if (hit === null) return shift ? [...current] : [];
  if (hit.owner !== owner) return shift ? [...current] : [hit.id];
  if (!shift || !allOwn(current, get, owner)) return [hit.id];
  return current.includes(hit.id) ? current.filter((id) => id !== hit.id) : sortedUnique([...current, hit.id]);
}

/**
 * Drag box. Only own units are boxed (buildings and nodes never are). Shift
 * adds to the selection; without shift an empty box clears it.
 */
export function boxSelection(
  current: readonly EntityId[],
  boxed: readonly EntityId[],
  shift: boolean,
  owner: PlayerId,
  get: EntityLookup,
): EntityId[] {
  const units = boxed.filter((id) => {
    const e = get(id);
    return e !== undefined && e.kind === 'unit' && e.owner === owner;
  });
  if (units.length === 0) return shift ? [...current] : [];
  if (!shift || !allOwn(current, get, owner)) return sortedUnique(units);
  return sortedUnique([...current, ...units]);
}

/**
 * Double-click: every own entity of the clicked one's kind and type among
 * `visible` (entities currently on screen). Shift adds to the selection.
 */
export function sameTypeSelection(
  clicked: ReadonlyEntity,
  visible: readonly ReadonlyEntity[],
  current: readonly EntityId[],
  shift: boolean,
  owner: PlayerId,
  get: EntityLookup,
): EntityId[] {
  if (clicked.owner !== owner) return [clicked.id];
  const same = visible.filter((e) => e.owner === owner && e.kind === clicked.kind && e.typeId === clicked.typeId).map((e) => e.id);
  const ids = [clicked.id, ...same];
  return shift && allOwn(current, get, owner) ? sortedUnique([...current, ...ids]) : sortedUnique(ids);
}

/** Drop ids whose entity no longer exists. Returns the same array when nothing changed. */
export function pruneIds(ids: readonly EntityId[], exists: (id: EntityId) => boolean): readonly EntityId[] {
  return ids.every(exists) ? ids : ids.filter(exists);
}

/** Centre of a set of entities in world tiles (unit position, footprint centre), or null if none resolve. */
export function centroid(ids: readonly EntityId[], get: EntityLookup, registry: DataRegistry): Vec2 | null {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const id of ids) {
    const e = get(id);
    if (e === undefined) continue;
    const p = entityCentre(e, registry);
    sx += p.x;
    sy += p.y;
    n++;
  }
  return n === 0 ? null : { x: sx / n, y: sy / n };
}

/** World position of an entity: unit position, or the centre of a building/node footprint. */
export function entityCentre(e: ReadonlyEntity, registry: DataRegistry): Vec2 {
  if (e.kind === 'unit') return { x: e.pos.x, y: e.pos.y };
  const def = registry.def(e.typeId);
  const size = def !== undefined && (def.kind === 'building' || def.kind === 'node') ? def.footprint : 1;
  return { x: e.tile.tx + size / 2, y: e.tile.ty + size / 2 };
}

/** A villager-type unit (can gather) with nothing to do. */
export function isIdleVillager(e: ReadonlyEntity, owner: PlayerId, registry: DataRegistry): boolean {
  if (e.kind !== 'unit' || e.owner !== owner) return false;
  const def = registry.def(e.typeId);
  if (def === undefined || def.kind !== 'unit' || def.gather === undefined) return false;
  return e.currentOrder === null && e.orderQueue.length === 0 && e.path === null && e.pendingPathRequestId === null;
}

/**
 * A military unit (`autoAcquire`) with nothing to do: no order, no queue, no path (plan 7.3). A unit on hold has
 * an order, so it does not count.
 */
export function isIdleMilitary(e: ReadonlyEntity, owner: PlayerId, registry: DataRegistry): boolean {
  if (e.kind !== 'unit' || e.owner !== owner || e.hp <= 0) return false;
  const def = registry.def(e.typeId);
  if (def === undefined || def.kind !== 'unit' || !def.combat.autoAcquire) return false;
  return e.currentOrder === null && e.orderQueue.length === 0 && e.path === null && e.pendingPathRequestId === null;
}

function nextMatching(
  entities: readonly ReadonlyEntity[],
  afterId: EntityId | null,
  matches: (e: ReadonlyEntity) => boolean,
): EntityId | null {
  let first: EntityId | null = null;
  for (const e of entities) {
    if (!matches(e)) continue;
    if (first === null) first = e.id;
    if (afterId === null || e.id > afterId) return e.id;
  }
  return first;
}

/**
 * Next idle villager after `afterId` in ascending id order, wrapping round.
 * `entities` must be ascending by id (as `state.entities` is).
 */
export function nextIdleVillager(
  entities: readonly ReadonlyEntity[],
  owner: PlayerId,
  afterId: EntityId | null,
  registry: DataRegistry,
): EntityId | null {
  return nextMatching(entities, afterId, (e) => isIdleVillager(e, owner, registry));
}

/** Next idle military unit after `afterId` in ascending id order, wrapping round (the `,` key). */
export function nextIdleMilitary(
  entities: readonly ReadonlyEntity[],
  owner: PlayerId,
  afterId: EntityId | null,
  registry: DataRegistry,
): EntityId | null {
  return nextMatching(entities, afterId, (e) => isIdleMilitary(e, owner, registry));
}

/** The player's first completed Town Center (lowest id), or null. */
export function findTownCenter(entities: readonly ReadonlyEntity[], owner: PlayerId, registry: DataRegistry): ReadonlyEntity | null {
  const typeId = registry.start.centerBuilding;
  for (const e of entities) if (e.kind === 'building' && e.owner === owner && e.typeId === typeId && e.constructed) return e;
  return null;
}

// ---------------------------------------------------------------------------
// Containers
// ---------------------------------------------------------------------------

/** Control groups 1-9. Ids of dead entities are dropped lazily. */
export class ControlGroups {
  private readonly groups = new Map<number, readonly EntityId[]>();

  /** Assign the group. An empty selection leaves the group unchanged. */
  assign(group: number, ids: readonly EntityId[]): void {
    if (ids.length > 0) this.groups.set(group, sortedUnique(ids));
  }

  get(group: number): readonly EntityId[] {
    return this.groups.get(group) ?? [];
  }

  /** The group with dead entities removed (and forgotten). */
  recall(group: number, exists: (id: EntityId) => boolean): readonly EntityId[] {
    const live = pruneIds(this.get(group), exists);
    if (live.length === 0) this.groups.delete(group);
    else this.groups.set(group, live);
    return live;
  }

  prune(exists: (id: EntityId) => boolean): void {
    for (const g of [...this.groups.keys()]) this.recall(g, exists);
  }
}

export type SelectionListener = (ids: readonly EntityId[]) => void;

/** The current selection. The HUD subscribes with `subscribe`. */
export class SelectionStore {
  private current: readonly EntityId[] = [];
  private readonly listeners = new Set<SelectionListener>();
  readonly groups = new ControlGroups();

  get ids(): readonly EntityId[] {
    return this.current;
  }

  /** Replace the selection (ascending, de-duplicated). Notifies only on change. */
  set(ids: readonly EntityId[]): void {
    const next = sortedUnique(ids);
    if (sameIds(next, this.current)) return;
    this.current = next;
    for (const l of [...this.listeners]) l(next);
  }

  clear(): void {
    this.set([]);
  }

  /** Remove entities that no longer exist; also prunes the control groups. */
  prune(exists: (id: EntityId) => boolean): void {
    this.groups.prune(exists);
    const live = pruneIds(this.current, exists);
    if (live !== this.current) this.set(live);
  }

  /** Subscribe to selection changes. Returns an unsubscribe function. */
  subscribe(listener: SelectionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export interface ClickRecord {
  id: EntityId;
  time: number;
}

/** Max gap between two clicks to count as a double click. */
export const DOUBLE_CLICK_WINDOW_MS = 400;

/**
 * Double-click tracking. Returns whether this click is a double and the
 * record to remember. A shift click is never a double and resets the tracker.
 */
export function trackClick(
  last: ClickRecord | null,
  hitId: EntityId | null,
  shift: boolean,
  now: number,
): { isDouble: boolean; next: ClickRecord | null } {
  if (shift || hitId === null) return { isDouble: false, next: null };
  const isDouble = last !== null && last.id === hitId && now - last.time <= DOUBLE_CLICK_WINDOW_MS;
  return { isDouble, next: isDouble ? null : { id: hitId, time: now } };
}
