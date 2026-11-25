/** `build` and `assist` orders, `assist` command. Owned by WP7. */

import type { BuildingDef, UnitDef } from '../../../data/schema';
import { findEntity } from '../../entities';
import { followPath } from '../../path/follow';
import { isAdjacentToFootprint } from '../../path/approach';
import { emit, reject, type CommandHandler } from '../common';
import { addBuilder, removeBuilder } from '../construct';
import { facingFromDelta } from '../movement';
import { assignOrder, validateOwnUnits, type OrderHandler, type OrderStep } from './index';
import type {
  AssistOrderState,
  BuildOrderState,
  BuildingEntity,
  SimContext,
  UnitEntity,
} from '../../types';

type SiteState = BuildOrderState | AssistOrderState;

function buildingDef(ctx: SimContext, b: BuildingEntity): BuildingDef | null {
  const def = ctx.data.def(b.typeId);
  return def !== undefined && def.kind === 'building' ? def : null;
}

function unitDef(ctx: SimContext, unit: UnitEntity): UnitDef | null {
  const def = ctx.data.def(unit.typeId);
  return def !== undefined && def.kind === 'unit' ? def : null;
}

/** The unit can work a farm and no one else is on it (or about to be: gather orders in progress count). */
function farmIsFree(ctx: SimContext, unit: UnitEntity, farm: BuildingEntity, def: BuildingDef): boolean {
  const udef = unitDef(ctx, unit);
  if (udef === null || udef.gather === undefined || udef.gather.rates.farm === undefined) return false;
  if (def.farm === undefined) return false;
  let taken = farm.gathererIds.filter((id) => id !== unit.id).length;
  for (const e of ctx.state.entities) {
    if (e.kind !== 'unit' || e.id === unit.id) continue;
    const o = e.currentOrder;
    if (o !== null && o.type === 'gather' && o.targetId === farm.id && !farm.gathererIds.includes(e.id)) taken++;
  }
  return taken < def.farm.maxGatherers;
}

/**
 * Nearest (to the building's centre) resource node whose resource the
 * building accepts, that the unit can gather and that has room; ties by
 * lowest id. `null` if none.
 */
function nearestMatchingNode(ctx: SimContext, unit: UnitEntity, b: BuildingEntity, def: BuildingDef): number | null {
  const udef = unitDef(ctx, unit);
  if (udef === null || udef.gather === undefined) return null;
  const cx = b.tile.tx + def.footprint / 2;
  const cy = b.tile.ty + def.footprint / 2;
  let best: number | null = null;
  let bestD = 0;
  for (const e of ctx.state.entities) {
    if (e.kind !== 'node' || e.amount <= 0) continue;
    const ndef = ctx.data.def(e.typeId);
    if (ndef === undefined || ndef.kind !== 'node') continue;
    if (!def.dropOff.includes(ndef.resource)) continue;
    if (udef.gather.rates[ndef.gatherKind] === undefined) continue;
    if (e.gathererIds.length >= ndef.maxGatherers) continue;
    const dx = e.tile.tx + ndef.footprint / 2 - cx;
    const dy = e.tile.ty + ndef.footprint / 2 - cy;
    const d = dx * dx + dy * dy;
    if (best === null || d < bestD) {
      best = e.id;
      bestD = d;
    }
  }
  return best;
}

/** Nothing left to do: tell the player (unless more orders are queued) and finish. */
function finish(ctx: SimContext, unit: UnitEntity): OrderStep {
  if (unit.orderQueue.length === 0) emit(ctx, { type: 'VillagerIdle', playerId: unit.owner, unitId: unit.id });
  return 'done';
}

/**
 * What a unit does once its target is complete (plan 4.4): with orders queued,
 * the next one (`done`); otherwise builders of a camp or mill gather the
 * nearest matching resource, the builder of a farm works it (also for an
 * `assist` on a completed farm, even with orders queued), else idle.
 */
function afterBuilt(ctx: SimContext, unit: UnitEntity, b: BuildingEntity, wasBuilding: boolean): OrderStep {
  const def = buildingDef(ctx, b);
  if (def === null) return finish(ctx, unit);
  if (def.farm !== undefined) {
    if ((wasBuilding && unit.orderQueue.length > 0) || !farmIsFree(ctx, unit, b, def)) {
      return finish(ctx, unit);
    }
    return { replace: { type: 'gather', targetId: b.id } };
  }
  if (!wasBuilding) return finish(ctx, unit);
  if (unit.orderQueue.length > 0) return 'done';
  if (def.tags.includes('dropOff') && def.dropOff.length > 0) {
    const nodeId = nearestMatchingNode(ctx, unit, b, def);
    if (nodeId !== null) return { replace: { type: 'gather', targetId: nodeId } };
  }
  return finish(ctx, unit);
}

function beginSite<S extends SiteState>(ctx: SimContext, order: Omit<S, 'phase'>, assist: boolean): S | null {
  const b = findEntity(ctx.state, (order as { buildingId: number }).buildingId);
  if (b === undefined || b.kind !== 'building') return null;
  if (b.constructed && !(assist && buildingDef(ctx, b)?.farm !== undefined)) return null;
  return { ...order, phase: 'start' } as S;
}

function runSite(ctx: SimContext, unit: UnitEntity, state: SiteState): OrderStep {
  const b = findEntity(ctx.state, state.buildingId);
  if (b === undefined || b.kind !== 'building') return finish(ctx, unit);
  const def = buildingDef(ctx, b);
  if (def === null) return finish(ctx, unit);
  if (b.constructed) return afterBuilt(ctx, unit, b, state.phase === 'building');

  const near = isAdjacentToFootprint(unit.pos, b.tile, def.footprint);
  if (state.phase === 'building') {
    if (near) return 'running';
    removeBuilder(b, unit.id);
    state.phase = 'toSite';
    unit.path = null;
    unit.pendingPathRequestId = null;
  }
  if (state.phase === 'start') state.phase = 'toSite';
  if (near) {
    state.phase = 'building';
    unit.path = null;
    unit.pendingPathRequestId = null;
    addBuilder(b, unit.id);
    const f = facingFromDelta(b.tile.tx + def.footprint / 2 - unit.pos.x, b.tile.ty + def.footprint / 2 - unit.pos.y);
    if (f !== null) unit.facing = f;
    return 'running';
  }
  const status = followPath(ctx, unit, { kind: 'footprint', tile: b.tile, size: def.footprint });
  // Path used up without reaching the site: it cannot be reached, give up.
  return status === 'arrived' ? finish(ctx, unit) : 'running';
}

function endSite(ctx: SimContext, unit: UnitEntity, state: SiteState): void {
  const b = findEntity(ctx.state, state.buildingId);
  if (b !== undefined && b.kind === 'building') removeBuilder(b, unit.id);
}

/**
 * Walk to the foundation's footprint, then contribute progress while adjacent
 * (the construction step counts builders in the `building` phase). A removed
 * or already finished target ends the order; completion auto-continues (see
 * `afterBuilt`) through the `replace` step.
 */
export const buildOrderHandler: OrderHandler<'build'> = {
  begin: (ctx, _unit, order) => beginSite<BuildOrderState>(ctx, order, false),
  run: (ctx, unit, state) => runSite(ctx, unit, state),
  end: (ctx, unit, state) => endSite(ctx, unit, state),
};

/** Identical to `build` once started; additionally accepts a completed farm (becomes `gather`). */
export const assistOrderHandler: OrderHandler<'assist'> = {
  begin: (ctx, _unit, order) => beginSite<AssistOrderState>(ctx, order, true),
  run: (ctx, unit, state) => runSite(ctx, unit, state),
  end: (ctx, unit, state) => endSite(ctx, unit, state),
};

/**
 * Help with an own building. Unfinished: needs units that can build its type
 * (`cannotPerform` otherwise), becomes an `assist` order. Completed farm:
 * units that can farm get a `gather` order on it. Completed anything else:
 * `invalidTarget`. Rejects `unknownEntity`, `notOwner`, `invalidTarget` (not a
 * building) before touching any unit.
 */
export const applyAssistCommand: CommandHandler<'assist'> = (ctx, cmd) => {
  const units = validateOwnUnits(ctx, cmd, cmd.unitIds);
  if (units === null || units.length === 0) return;
  const b = findEntity(ctx.state, cmd.buildingId);
  if (b === undefined) return reject(ctx, cmd, 'unknownEntity');
  if (b.owner !== cmd.playerId) return reject(ctx, cmd, 'notOwner');
  if (b.kind !== 'building') return reject(ctx, cmd, 'invalidTarget');
  const def = buildingDef(ctx, b);
  if (def === null) return reject(ctx, cmd, 'invalidTarget');
  if (b.constructed) {
    if (def.farm === undefined) return reject(ctx, cmd, 'invalidTarget');
    for (const u of units) {
      if (unitDef(ctx, u)?.gather?.rates.farm === undefined) return reject(ctx, cmd, 'cannotPerform');
    }
    for (const u of units) assignOrder(ctx, u, { type: 'gather', targetId: b.id }, cmd.queue);
    return;
  }
  for (const u of units) {
    if (!(unitDef(ctx, u)?.builds ?? []).includes(def.id)) return reject(ctx, cmd, 'cannotPerform');
  }
  for (const u of units) assignOrder(ctx, u, { type: 'assist', buildingId: b.id }, cmd.queue);
};
