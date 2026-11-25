/** Tick step 7 (construction progress), build and cancelConstruction commands. Owned by WP7. */

import type { BuildingDef } from '../../data/schema';
import { createBuilding, findEntity, removeEntities } from '../entities';
import { setFootprint } from '../map/occupancy';
import { canPlace } from '../rules/placement';
import { emit, reject, type CommandHandler } from './common';
import { assignOrder, endCurrentOrder, validateOwnUnits } from './orders';
import { RESOURCE_TYPES, TICK_RATE } from '../types';
import type {
  BuildingEntity,
  EntityId,
  PlacementTileProblem,
  SimContext,
  TilePos,
  UnitEntity,
} from '../types';

/** Progress at or above this counts as complete (absorbs float drift of summed fractions). */
const COMPLETE_EPSILON = 1e-9;

/** Speed multiplier with `n` builders: `1 + 0.5 * (n - 1)` (0 for no builders). */
export function builderSpeedMultiplier(n: number): number {
  return n <= 0 ? 0 : 1 + 0.5 * (n - 1);
}

/** Build time in ticks for one builder: resolved `buildTime` (cache, else def) in seconds, at least 1 tick. */
export function buildTicks(ctx: SimContext, building: BuildingEntity, def: BuildingDef): number {
  const cached = ctx.runtime.resolvedStats[building.owner]?.[building.typeId]?.buildTime;
  const seconds = cached !== undefined && Number.isFinite(cached) && cached > 0 ? cached : def.buildTime;
  return Math.max(1, Math.round(seconds * TICK_RATE));
}

/** Insert `id` into the building's ascending builder list unless present. */
export function addBuilder(building: BuildingEntity, id: EntityId): void {
  const list = building.builderIds;
  let i = 0;
  while (i < list.length && (list[i] as EntityId) < id) i++;
  if (list[i] !== id) list.splice(i, 0, id);
}

/** Remove `id` from the building's builder list. */
export function removeBuilder(building: BuildingEntity, id: EntityId): void {
  const i = building.builderIds.indexOf(id);
  if (i >= 0) building.builderIds.splice(i, 1);
}

/** True if `unit` is currently executing a build/assist order on `buildingId` in its `building` phase. */
function isBuildingNow(unit: UnitEntity, buildingId: EntityId): boolean {
  const o = unit.currentOrder;
  return o !== null && (o.type === 'build' || o.type === 'assist') && o.buildingId === buildingId && o.phase === 'building';
}

/**
 * Advance every unfinished building by its builders:
 * speed multiplier `1 + 0.5 * (n - 1)` for n builders; completion emits
 * BuildingCompleted. Progress per tick is `multiplier / buildTicks`. The
 * builder list is first pruned of units that are gone or no longer building
 * this foundation, so it stays correct whatever happened to them.
 */
export function runConstruction(ctx: SimContext): void {
  for (const e of ctx.state.entities) {
    if (e.kind !== 'building' || e.constructed) continue;
    const def = ctx.data.def(e.typeId);
    if (def === undefined || def.kind !== 'building') continue;
    e.builderIds = e.builderIds.filter((id) => {
      const u = findEntity(ctx.state, id);
      return u !== undefined && u.kind === 'unit' && isBuildingNow(u, e.id);
    });
    const n = e.builderIds.length;
    if (n === 0) continue;
    const owner = ctx.state.players[e.owner];
    if (owner !== undefined && owner.cheats.instantBuild) {
      e.progress = 1;
    } else {
      e.progress += builderSpeedMultiplier(n) / buildTicks(ctx, e, def);
    }
    if (e.progress >= 1 - COMPLETE_EPSILON) {
      e.progress = 1;
      e.constructed = true;
      e.builderIds = [];
      emit(ctx, { type: 'BuildingCompleted', playerId: e.owner, buildingId: e.id, buildingType: e.typeId });
    }
  }
}

/**
 * Move every unit standing inside the footprint to the nearest free tile
 * centre outside it: the first ring (Chebyshev distance from the footprint)
 * that has a free tile, nearest tile centre to the unit, ties by tile index.
 * Displaced units drop their path and any pending request so they re-path.
 */
function displaceUnits(ctx: SimContext, tile: TilePos, size: number): void {
  const { width, height } = ctx.state.map;
  const occ = ctx.runtime.occupancy;
  const displaced = new Set<EntityId>();
  for (const e of ctx.state.entities) {
    if (e.kind !== 'unit') continue;
    const ux = Math.floor(e.pos.x);
    const uy = Math.floor(e.pos.y);
    if (ux < tile.tx || ux >= tile.tx + size || uy < tile.ty || uy >= tile.ty + size) continue;
    let best: { x: number; y: number } | null = null;
    const maxRing = Math.max(width, height);
    for (let r = 1; r <= maxRing && best === null; r++) {
      let bestD = 0;
      let bestI = 0;
      for (let y = tile.ty - r; y <= tile.ty + size - 1 + r; y++) {
        for (let x = tile.tx - r; x <= tile.tx + size - 1 + r; x++) {
          const onRing = x === tile.tx - r || x === tile.tx + size - 1 + r || y === tile.ty - r || y === tile.ty + size - 1 + r;
          if (!onRing || x < 0 || y < 0 || x >= width || y >= height) continue;
          const i = y * width + x;
          if (occ[i] !== 0) continue;
          const dx = x + 0.5 - e.pos.x;
          const dy = y + 0.5 - e.pos.y;
          const d = dx * dx + dy * dy;
          if (best === null || d < bestD || (d === bestD && i < bestI)) {
            best = { x: x + 0.5, y: y + 0.5 };
            bestD = d;
            bestI = i;
          }
        }
      }
    }
    if (best === null) continue;
    e.pos = { x: best.x, y: best.y };
    e.prevPos = { x: best.x, y: best.y };
    e.path = null;
    e.pendingPathRequestId = null;
    displaced.add(e.id);
  }
  if (displaced.size > 0) ctx.state.pathQueue = ctx.state.pathQueue.filter((r) => !displaced.has(r.unitId));
}

/**
 * Validate with canPlace, deduct cost, create the foundation, assign build
 * orders. Rejections (nothing changes): `unknownEntity`/`notOwner`/
 * `cannotPerform` for the units (a unit whose def does not list the building
 * in `builds` is `cannotPerform`), `unknownDef` / `invalidTarget` for the
 * type, `notAvailable`, `cannotPlace`, `cannotAfford` in that order.
 *
 * A blocking foundation is added to the occupancy grid at once and
 * `occupancyVersion` is bumped so stale paths re-path; units inside the
 * footprint are displaced. Non-blocking defs (farms) change neither.
 */
export const applyBuildCommand: CommandHandler<'build'> = (ctx, cmd) => {
  const units = validateOwnUnits(ctx, cmd, cmd.unitIds);
  if (units === null || units.length === 0) return;
  const def = ctx.data.def(cmd.buildingType);
  if (def === undefined) return reject(ctx, cmd, 'unknownDef');
  if (def.kind !== 'building' || !def.buildable) return reject(ctx, cmd, 'invalidTarget');
  for (const u of units) {
    const udef = ctx.data.def(u.typeId);
    if (udef === undefined || udef.kind !== 'unit' || !(udef.builds ?? []).includes(def.id)) {
      return reject(ctx, cmd, 'cannotPerform');
    }
  }
  const player = ctx.state.players[cmd.playerId];
  if (player === undefined) return reject(ctx, cmd, 'invalidCommand');
  const result = canPlace(ctx, cmd.playerId, def.id, cmd.tx, cmd.ty);
  if (!result.availability.available) {
    return reject(ctx, cmd, 'notAvailable', { unavailable: result.availability.reasons });
  }
  const problems = result.tiles.filter((t): t is PlacementTileProblem => t !== null);
  if (problems.length > 0) return reject(ctx, cmd, 'cannotPlace', { placement: problems });
  if (!result.availability.affordable) {
    return reject(ctx, cmd, 'cannotAfford', { shortfall: result.availability.shortfall });
  }

  const cost = result.availability.cost;
  for (const r of RESOURCE_TYPES) player.resources[r] -= cost[r];
  const building = createBuilding(ctx.state, def.id, cmd.playerId, cmd.tx, cmd.ty, false, cost);
  if (def.blocking) {
    setFootprint(ctx.runtime.occupancy, ctx.state.map.width, ctx.state.map.height, building.tile, def.footprint, 1);
    ctx.state.occupancyVersion += 1;
  }
  emit(ctx, {
    type: 'BuildingPlaced',
    playerId: cmd.playerId,
    buildingId: building.id,
    buildingType: def.id,
    tx: cmd.tx,
    ty: cmd.ty,
  });
  for (const u of units) assignOrder(ctx, u, { type: 'build', buildingId: building.id }, cmd.queue);
  if (def.blocking) displaceUnits(ctx, building.tile, def.footprint);
};

/**
 * Remove an own unfinished building at once: refund `costPaid` in full, free
 * the footprint, end the build/assist orders (current ones; queued ones are
 * skipped when they come up) of every unit that targets it, and release the
 * builder list. Rejects `unknownEntity`, `notOwner`, `invalidTarget` (not a
 * building, or already finished).
 */
export const applyCancelConstructionCommand: CommandHandler<'cancelConstruction'> = (ctx, cmd) => {
  const b = findEntity(ctx.state, cmd.buildingId);
  if (b === undefined) return reject(ctx, cmd, 'unknownEntity');
  if (b.owner !== cmd.playerId) return reject(ctx, cmd, 'notOwner');
  if (b.kind !== 'building' || b.constructed || ctx.runtime.pendingRemoval.includes(b.id)) {
    return reject(ctx, cmd, 'invalidTarget');
  }
  const player = ctx.state.players[cmd.playerId];
  if (player === undefined) return reject(ctx, cmd, 'invalidCommand');
  for (const e of ctx.state.entities) {
    if (e.kind !== 'unit') continue;
    const o = e.currentOrder;
    if (o !== null && (o.type === 'build' || o.type === 'assist') && o.buildingId === b.id) endCurrentOrder(ctx, e);
  }
  for (const r of RESOURCE_TYPES) player.resources[r] += b.costPaid[r];
  const def = ctx.data.def(b.typeId);
  if (def !== undefined && def.kind === 'building' && def.blocking) {
    setFootprint(ctx.runtime.occupancy, ctx.state.map.width, ctx.state.map.height, b.tile, def.footprint, 0);
    ctx.state.occupancyVersion += 1;
  }
  b.builderIds = [];
  removeEntities(ctx.state, [b.id]);
};
