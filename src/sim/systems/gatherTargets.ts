/**
 * Shared helpers for the gather and drop-off orders (plan 4.4). Owned by WP6.
 *
 * Gather targets are resource nodes or completed own farms. Everything here
 * is pure over state/data and deterministic: iteration is in ascending entity
 * id and every tie goes to the lowest id.
 */

import { findEntity } from '../entities';
import { approachTile } from '../path/approach';
import {
  GATHER_RETARGET_RADIUS,
  type BuildingEntity,
  type Entity,
  type EntityId,
  type GatherKind,
  type PlayerId,
  type ResourceNodeEntity,
  type ResourceType,
  type SimContext,
  type StatKey,
  type TilePos,
  type UnitEntity,
  type Vec2,
} from '../types';

/** A node or farm that can currently be gathered, with the numbers the loop needs. */
export interface GatherTarget {
  entity: ResourceNodeEntity | BuildingEntity;
  tile: TilePos;
  size: number;
  centre: Vec2;
  resource: ResourceType;
  kind: GatherKind;
  maxGatherers: number;
  /** Farms never lose amount. */
  infinite: boolean;
}

/**
 * Describe `entity` as a gather target for a unit of `owner`, or `null` if it
 * is gone, depleted, not a node or farm, or (for farms) unfinished or owned by
 * someone else.
 */
export function gatherTargetOf(ctx: SimContext, entity: Entity | undefined, owner: PlayerId): GatherTarget | null {
  if (entity === undefined) return null;
  if (entity.kind === 'node') {
    if (entity.amount <= 0) return null;
    const def = ctx.data.def(entity.typeId);
    if (def === undefined || def.kind !== 'node') return null;
    return {
      entity,
      tile: entity.tile,
      size: def.footprint,
      centre: { x: entity.tile.tx + def.footprint / 2, y: entity.tile.ty + def.footprint / 2 },
      resource: def.resource,
      kind: def.gatherKind,
      maxGatherers: def.maxGatherers,
      infinite: false,
    };
  }
  if (entity.kind === 'building') {
    if (!entity.constructed || entity.owner !== owner) return null;
    const def = ctx.data.def(entity.typeId);
    if (def === undefined || def.kind !== 'building' || def.farm === undefined) return null;
    return {
      entity,
      tile: entity.tile,
      size: def.footprint,
      centre: { x: entity.tile.tx + def.footprint / 2, y: entity.tile.ty + def.footprint / 2 },
      resource: def.farm.resource,
      kind: def.farm.gatherKind,
      maxGatherers: def.farm.maxGatherers,
      infinite: true,
    };
  }
  return null;
}

/**
 * A resolved stat for a unit's owner: the per-player cache WP8 maintains in
 * `runtime.resolvedStats` if it has the value, else the def's base value.
 * Never throws, so it works with the stat-resolution stub and keeps working
 * once the real cache is filled.
 */
function statOr(ctx: SimContext, unit: UnitEntity, stat: StatKey, base: number): number {
  const cached = ctx.runtime.resolvedStats[unit.owner]?.[unit.typeId]?.[stat];
  return cached !== undefined && Number.isFinite(cached) ? cached : base;
}

/** Gather rate per second for `kind`, or 0 if the unit cannot gather that kind. */
export function gatherRate(ctx: SimContext, unit: UnitEntity, kind: GatherKind): number {
  const def = ctx.data.def(unit.typeId);
  if (def === undefined || def.kind !== 'unit' || def.gather === undefined) return 0;
  const base = def.gather.rates[kind];
  if (base === undefined || !(base > 0)) return 0;
  const rate = statOr(ctx, unit, `gatherRate.${kind}`, base);
  return rate > 0 ? rate : 0;
}

/** Whole units the unit carries before returning (at least 1). */
export function carryCapacity(ctx: SimContext, unit: UnitEntity): number {
  const def = ctx.data.def(unit.typeId);
  const base = def !== undefined && def.kind === 'unit' && def.gather !== undefined ? def.gather.carryCapacity : 1;
  return Math.max(1, Math.floor(statOr(ctx, unit, 'carryCapacity', base)));
}

function insertSorted(ids: EntityId[], id: EntityId): void {
  let i = 0;
  while (i < ids.length && (ids[i] as EntityId) < id) i++;
  if (ids[i] !== id) ids.splice(i, 0, id);
}

/** Does `target` have a free slot for `unitId` (or already hold one for it)? */
export function hasRoom(target: GatherTarget, unitId: EntityId): boolean {
  return target.entity.gathererIds.includes(unitId) || target.entity.gathererIds.length < target.maxGatherers;
}

/** Take a gatherer slot (idempotent, list stays ascending). */
export function claimSlot(target: GatherTarget, unitId: EntityId): void {
  insertSorted(target.entity.gathererIds, unitId);
}

/** Release `unitId`'s slot on entity `id` if that entity still exists. */
export function releaseSlot(ctx: SimContext, id: EntityId, unitId: EntityId): void {
  const e = findEntity(ctx.state, id);
  if (e === undefined || e.kind === 'unit') return;
  const i = e.gathererIds.indexOf(unitId);
  if (i >= 0) e.gathererIds.splice(i, 1);
}

/** Can this unit reach a tile next to the footprint at all? */
function reachable(ctx: SimContext, unit: UnitEntity, tile: TilePos, size: number): boolean {
  return approachTile(ctx, unit.pos, tile, size) !== null;
}

/**
 * The nearest gatherable node or own farm of `resource` within
 * GATHER_RETARGET_RADIUS tiles of `anchor` (centre to centre, straight line)
 * that has a free slot, that the unit can gather and walk to. Ties: lowest id.
 */
export function findRetarget(ctx: SimContext, unit: UnitEntity, anchor: Vec2, resource: ResourceType): GatherTarget | null {
  const maxD2 = GATHER_RETARGET_RADIUS * GATHER_RETARGET_RADIUS;
  let best: GatherTarget | null = null;
  let bestD = 0;
  for (const e of ctx.state.entities) {
    if (e.kind === 'unit') continue;
    const t = gatherTargetOf(ctx, e, unit.owner);
    if (t === null || t.resource !== resource || !hasRoom(t, unit.id)) continue;
    const dx = t.centre.x - anchor.x;
    const dy = t.centre.y - anchor.y;
    const d = dx * dx + dy * dy;
    if (d > maxD2 || (best !== null && d >= bestD)) continue;
    if (gatherRate(ctx, unit, t.kind) <= 0 || !reachable(ctx, unit, t.tile, t.size)) continue;
    best = t;
    bestD = d;
  }
  return best;
}

/** A completed own building that accepts `resource`, or `null`. */
export function dropOffBuilding(ctx: SimContext, id: EntityId, owner: PlayerId, resource: ResourceType): BuildingEntity | null {
  const e = findEntity(ctx.state, id);
  if (e === undefined || e.kind !== 'building' || e.owner !== owner || !e.constructed) return null;
  const def = ctx.data.def(e.typeId);
  if (def === undefined || def.kind !== 'building' || !def.dropOff.includes(resource)) return null;
  return e;
}

/** Footprint side of a building. */
export function buildingSize(ctx: SimContext, b: BuildingEntity): number {
  const def = ctx.data.def(b.typeId);
  return def !== undefined && def.kind === 'building' ? def.footprint : 1;
}

/**
 * Nearest completed own drop-off for `resource` that the unit can walk to
 * (straight-line distance from the unit to the footprint centre; ties by id).
 */
export function nearestDropOff(ctx: SimContext, unit: UnitEntity, resource: ResourceType): BuildingEntity | null {
  let best: BuildingEntity | null = null;
  let bestD = 0;
  for (const e of ctx.state.entities) {
    if (e.kind !== 'building') continue;
    if (dropOffBuilding(ctx, e.id, unit.owner, resource) === null) continue;
    const size = buildingSize(ctx, e);
    const dx = e.tile.tx + size / 2 - unit.pos.x;
    const dy = e.tile.ty + size / 2 - unit.pos.y;
    const d = dx * dx + dy * dy;
    if (best !== null && d >= bestD) continue;
    if (!reachable(ctx, unit, e.tile, size)) continue;
    best = e;
    bestD = d;
  }
  return best;
}

/** Add the carried load to the owner's resources and empty the unit's hands. */
export function depositCarried(ctx: SimContext, unit: UnitEntity): void {
  const c = unit.carried;
  if (c === null) return;
  const player = ctx.state.players[unit.owner];
  if (player !== undefined) player.resources[c.type] += c.amount;
  unit.carried = null;
}
