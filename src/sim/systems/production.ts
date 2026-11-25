/** Tick step 2 (production and research queues), train/cancelQueue/setRally. Owned by WP8. */

import { createUnit, findEntity } from '../entities';
import { availability } from '../rules/availability';
import { resolvedCost, resolvedStat } from '../rules/stats';
import { reject, emit, type CommandHandler } from './common';
import { assignOrder } from './orders';
import { livingPopulation, recomputePopulation } from './population';
import { completeResearch } from './research';
import {
  MAX_PRODUCTION_QUEUE,
  RESOURCE_TYPES,
  TICK_RATE,
  type BuildingEntity,
  type Command,
  type EntityId,
  type Order,
  type PlayerState,
  type ProductionItem,
  type SimContext,
  type UnitEntity,
  type Vec2,
} from '../types';

/** Rings of tiles around a building searched for a spawn tile (1 = directly adjacent). */
const MAX_SPAWN_RING = 3;

/**
 * Validate that `buildingId` is an own, completed building. Rejects
 * (unknownEntity, cannotPerform, notOwner, notConstructed) and returns null
 * otherwise.
 */
export function validateProducer(ctx: SimContext, cmd: Command, buildingId: EntityId): BuildingEntity | null {
  const e = findEntity(ctx.state, buildingId);
  const fail = (reason: 'unknownEntity' | 'notOwner' | 'cannotPerform' | 'notConstructed'): null => {
    reject(ctx, cmd, reason);
    return null;
  };
  if (e === undefined) return fail('unknownEntity');
  if (e.owner !== cmd.playerId) return fail('notOwner');
  if (e.kind !== 'building') return fail('cannotPerform');
  if (!e.constructed) return fail('notConstructed');
  return e;
}

/**
 * Append a unit or tech to the building's queue: checks queue length,
 * availability and affordability, deducts the resolved cost and fixes
 * `ticksTotal`. Rejects and returns false on failure.
 */
export function enqueueItem(
  ctx: SimContext,
  cmd: Command,
  building: BuildingEntity,
  spec: { kind: 'unit'; unitType: string } | { kind: 'tech'; techId: string },
): boolean {
  if (building.queue.length >= MAX_PRODUCTION_QUEUE) {
    reject(ctx, cmd, 'queueFull');
    return false;
  }
  const defId = spec.kind === 'unit' ? spec.unitType : spec.techId;
  const av = availability(ctx, cmd.playerId, defId);
  if (!av.available) {
    reject(ctx, cmd, 'notAvailable', { unavailable: av.reasons });
    return false;
  }
  if (!av.affordable) {
    reject(ctx, cmd, 'cannotAfford', { shortfall: av.shortfall });
    return false;
  }
  const player = ctx.state.players[cmd.playerId] as PlayerState;
  const costPaid = resolvedCost(ctx, cmd.playerId, defId);
  for (const r of RESOURCE_TYPES) player.resources[r] -= costPaid[r];
  const seconds = resolvedStat(ctx, cmd.playerId, defId, spec.kind === 'unit' ? 'trainTime' : 'researchTime');
  const ticksTotal = Math.max(1, Math.round(seconds * TICK_RATE));
  if (spec.kind === 'unit') {
    building.queue.push({ kind: 'unit', unitType: spec.unitType, costPaid, ticksDone: 0, ticksTotal, popCapNotified: false });
  } else {
    building.queue.push({ kind: 'tech', techId: spec.techId, costPaid, ticksDone: 0, ticksTotal });
  }
  recomputePopulation(ctx);
  return true;
}

/** Queue a unit at an own completed building that trains it. */
export const applyTrainCommand: CommandHandler<'train'> = (ctx, cmd) => {
  const building = validateProducer(ctx, cmd, cmd.buildingId);
  if (building === null) return;
  const def = ctx.data.def(cmd.unitType);
  if (def === undefined || def.kind !== 'unit') return reject(ctx, cmd, 'unknownDef');
  if (!ctx.data.building(building.typeId).trains.includes(cmd.unitType)) return reject(ctx, cmd, 'cannotPerform');
  enqueueItem(ctx, cmd, building, { kind: 'unit', unitType: cmd.unitType });
};

/** Remove the queue item at `index` (0 = in progress) and refund its paid cost in full. */
export const applyCancelQueueCommand: CommandHandler<'cancelQueue'> = (ctx, cmd) => {
  const e = findEntity(ctx.state, cmd.buildingId);
  if (e === undefined) return reject(ctx, cmd, 'unknownEntity');
  if (e.owner !== cmd.playerId) return reject(ctx, cmd, 'notOwner');
  if (e.kind !== 'building') return reject(ctx, cmd, 'cannotPerform');
  if (cmd.index < 0 || cmd.index >= e.queue.length) return reject(ctx, cmd, 'invalidIndex');
  const [item] = e.queue.splice(cmd.index, 1) as [ProductionItem];
  const player = ctx.state.players[cmd.playerId] as PlayerState;
  for (const r of RESOURCE_TYPES) player.resources[r] += item.costPaid[r];
  recomputePopulation(ctx);
};

/**
 * Set the rally point of own buildings that train units. All-or-nothing.
 * `targetId` (optional) must exist; the stored point is always (x, y).
 */
export const applySetRallyCommand: CommandHandler<'setRally'> = (ctx, cmd) => {
  const { width, height } = ctx.state.map;
  if (cmd.x < 0 || cmd.y < 0 || cmd.x > width || cmd.y > height) return reject(ctx, cmd, 'invalidTarget');
  if (cmd.targetId !== undefined && findEntity(ctx.state, cmd.targetId) === undefined) {
    return reject(ctx, cmd, 'invalidTarget');
  }
  const buildings: BuildingEntity[] = [];
  for (const id of cmd.buildingIds) {
    const e = findEntity(ctx.state, id);
    if (e === undefined) return reject(ctx, cmd, 'unknownEntity');
    if (e.owner !== cmd.playerId) return reject(ctx, cmd, 'notOwner');
    if (e.kind !== 'building' || ctx.data.building(e.typeId).trains.length === 0) {
      return reject(ctx, cmd, 'cannotPerform');
    }
    buildings.push(e);
  }
  for (const b of buildings) b.rally = { x: cmd.x, y: cmd.y, targetId: cmd.targetId ?? null };
};

/** World point a building's rally resolves to (the target's footprint centre if it still exists). */
function rallyPoint(ctx: SimContext, b: BuildingEntity): Vec2 | null {
  if (b.rally === null) return null;
  if (b.rally.targetId !== null) {
    const t = findEntity(ctx.state, b.rally.targetId);
    if (t !== undefined && t.kind !== 'unit') {
      const size = ctx.data.def(t.typeId)?.kind === 'node' ? ctx.data.node(t.typeId).footprint : ctx.data.building(t.typeId).footprint;
      return { x: t.tile.tx + size / 2, y: t.tile.ty + size / 2 };
    }
  }
  return { x: b.rally.x, y: b.rally.y };
}

/**
 * Free tile adjacent to the building nearest `target` (squared distance from
 * the tile centre, ties by tile index). Searches the 8-connected ring around
 * the footprint, then up to MAX_SPAWN_RING rings out. `null` if none is free.
 */
export function findSpawnTile(ctx: SimContext, b: BuildingEntity, target: Vec2): { tx: number; ty: number } | null {
  const { width, height } = ctx.state.map;
  const size = ctx.data.building(b.typeId).footprint;
  for (let ring = 1; ring <= MAX_SPAWN_RING; ring++) {
    let best: { tx: number; ty: number } | null = null;
    let bestD = 0;
    let bestIndex = 0;
    for (let ty = b.tile.ty - ring; ty < b.tile.ty + size + ring; ty++) {
      for (let tx = b.tile.tx - ring; tx < b.tile.tx + size + ring; tx++) {
        const onRing =
          tx === b.tile.tx - ring || tx === b.tile.tx + size + ring - 1 || ty === b.tile.ty - ring || ty === b.tile.ty + size + ring - 1;
        if (!onRing || tx < 0 || ty < 0 || tx >= width || ty >= height) continue;
        const index = ty * width + tx;
        if (ctx.runtime.occupancy[index] !== 0) continue;
        const dx = tx + 0.5 - target.x;
        const dy = ty + 0.5 - target.y;
        const d = dx * dx + dy * dy;
        if (best === null || d < bestD || (d === bestD && index < bestIndex)) {
          best = { tx, ty };
          bestD = d;
          bestIndex = index;
        }
      }
    }
    if (best !== null) return best;
  }
  return null;
}

/** The order a freshly trained unit gets from its building's rally point, or null. */
function rallyOrder(ctx: SimContext, b: BuildingEntity, unit: UnitEntity): Order | null {
  const point = rallyPoint(ctx, b);
  if (point === null || b.rally === null) return null;
  if (b.rally.targetId !== null) {
    const t = findEntity(ctx.state, b.rally.targetId);
    const rates = ctx.data.unit(unit.typeId).gather?.rates;
    if (t !== undefined && rates !== undefined) {
      if (t.kind === 'node' && rates[ctx.data.node(t.typeId).gatherKind] !== undefined) {
        return { type: 'gather', targetId: t.id };
      }
      if (t.kind === 'building' && t.owner === b.owner) {
        const farm = ctx.data.building(t.typeId).farm;
        if (farm !== undefined && rates[farm.gatherKind] !== undefined) return { type: 'gather', targetId: t.id };
      }
    }
  }
  return { type: 'move', x: point.x, y: point.y };
}

/** Spawn the finished unit of the front item. Returns false if there is no free tile. */
function spawnUnit(ctx: SimContext, b: BuildingEntity, unitType: string): boolean {
  const size = ctx.data.building(b.typeId).footprint;
  const target = rallyPoint(ctx, b) ?? { x: b.tile.tx + size / 2, y: b.tile.ty + size + 1 };
  const tile = findSpawnTile(ctx, b, target);
  if (tile === null) return false;
  const unit = createUnit(ctx.state, unitType, b.owner, tile.tx + 0.5, tile.ty + 0.5);
  emit(ctx, { type: 'UnitTrained', playerId: b.owner, unitId: unit.id, unitType, buildingId: b.id });
  const order = rallyOrder(ctx, b, unit);
  if (order !== null) assignOrder(ctx, unit, order, false);
  return true;
}

/**
 * Advance the front item of every completed building's queue by one tick
 * (instantly if the owner has the instantResearch cheat). Finished units
 * spawn (or hold at the pop cap); finished techs call `completeResearch`.
 *
 * A finished unit spawns when `livingPopulation + popCost <= popCap`; other
 * queued items do not reserve room. Otherwise it holds at 100% and emits
 * PopulationCapped once.
 */
export function runProduction(ctx: SimContext): void {
  recomputePopulation(ctx); // buildings may have completed or been lost since cleanup
  for (const b of ctx.state.entities) {
    if (b.kind !== 'building' || !b.constructed) continue;
    const item = b.queue[0];
    if (item === undefined) continue;
    const player = ctx.state.players[b.owner];
    if (player === undefined) continue;
    if (item.ticksDone < item.ticksTotal) {
      item.ticksDone = player.cheats.instantResearch ? item.ticksTotal : item.ticksDone + 1;
    }
    if (item.ticksDone < item.ticksTotal) continue;

    if (item.kind === 'tech') {
      b.queue.shift();
      completeResearch(ctx, b.owner, item.techId, b.id);
      continue;
    }
    const popCost = resolvedStat(ctx, b.owner, item.unitType, 'popCost');
    if (livingPopulation(ctx, b.owner) + popCost > player.popCap) {
      if (!item.popCapNotified) {
        item.popCapNotified = true;
        emit(ctx, { type: 'PopulationCapped', playerId: b.owner, buildingId: b.id, unitType: item.unitType });
      }
      continue;
    }
    if (spawnUnit(ctx, b, item.unitType)) {
      b.queue.shift();
      recomputePopulation(ctx);
    }
  }
}
