/** `repair` order and command (PLAN-M2 3.3, 4.8, 4.12). Owned by WP24 (Repair, movement and map). */

import type { BuildingDef } from '../../../data/schema';
import { findEntity } from '../../entities';
import { isAdjacentToFootprint } from '../../path/approach';
import { followPath } from '../../path/follow';
import { buildingCombat } from '../combat/damage';
import { emit, reject, type CommandHandler } from '../common';
import { facingFromDelta } from '../movement';
import { assignOrder, validateOwnUnits, type OrderHandler, type OrderStep } from './index';
import type { BuildingEntity, EntityId, RepairOrderState, SimContext, UnitEntity } from '../../types';

function buildingDef(ctx: SimContext, b: BuildingEntity): BuildingDef | null {
  const def = ctx.data.def(b.typeId);
  return def !== undefined && def.kind === 'building' ? def : null;
}

/** Insert `id` into the building's ascending repairer list unless present. */
export function addRepairer(building: BuildingEntity, id: EntityId): void {
  const list = building.repairerIds;
  let i = 0;
  while (i < list.length && (list[i] as EntityId) < id) i++;
  if (list[i] !== id) list.splice(i, 0, id);
}

/** Remove `id` from the building's repairer list. */
export function removeRepairer(building: BuildingEntity, id: EntityId): void {
  const i = building.repairerIds.indexOf(id);
  if (i >= 0) building.repairerIds.splice(i, 1);
}

/** True if `unit` is executing a repair order on `buildingId` in its `repairing` phase. */
export function isRepairingNow(unit: UnitEntity, buildingId: EntityId): boolean {
  const o = unit.currentOrder;
  return o !== null && o.type === 'repair' && o.buildingId === buildingId && o.phase === 'repairing';
}

/** Nothing left to do: tell the player (unless more orders are queued) and finish. */
function finish(ctx: SimContext, unit: UnitEntity): OrderStep {
  if (unit.orderQueue.length === 0) emit(ctx, { type: 'VillagerIdle', playerId: unit.owner, unitId: unit.id });
  return 'done';
}

/**
 * Walk to the footprint like `assist`; in phase `repairing` the unit is adjacent and listed in the building's
 * `repairerIds` (hp is restored by `runConstruction`); leaving adjacency returns it to walking. Done (with
 * `VillagerIdle` if nothing is queued) at max hp, when the building is gone, or when it cannot be reached.
 */
export const repairOrderHandler: OrderHandler<'repair'> = {
  begin: (ctx, _unit, order) => {
    const b = findEntity(ctx.state, order.buildingId);
    if (b === undefined || b.kind !== 'building' || !b.constructed) return null;
    return { ...order, phase: 'start' };
  },
  run: (ctx, unit, state) => {
    const b = findEntity(ctx.state, state.buildingId);
    if (b === undefined || b.kind !== 'building') return finish(ctx, unit);
    const def = buildingDef(ctx, b);
    if (def === null || !b.constructed) return finish(ctx, unit);
    if (b.hp >= buildingCombat(ctx, b.owner, b.typeId).maxHp) return finish(ctx, unit);

    const near = isAdjacentToFootprint(unit.pos, b.tile, def.footprint);
    if (state.phase === 'repairing') {
      if (near) {
        addRepairer(b, unit.id); // idempotent; also restores the entry after a load
        return 'running';
      }
      removeRepairer(b, unit.id);
      state.phase = 'toSite';
      unit.path = null;
      unit.pendingPathRequestId = null;
    }
    if (state.phase === 'start') state.phase = 'toSite';
    if (near) {
      state.phase = 'repairing';
      unit.path = null;
      unit.pendingPathRequestId = null;
      addRepairer(b, unit.id);
      const f = facingFromDelta(b.tile.tx + def.footprint / 2 - unit.pos.x, b.tile.ty + def.footprint / 2 - unit.pos.y);
      if (f !== null) unit.facing = f;
      return 'running';
    }
    const status = followPath(ctx, unit, { kind: 'footprint', tile: b.tile, size: def.footprint });
    // Path used up without reaching the building: it cannot be reached, give up.
    return status === 'arrived' ? finish(ctx, unit) : 'running';
  },
  end: (ctx, unit, state: RepairOrderState) => {
    const b = findEntity(ctx.state, state.buildingId);
    if (b !== undefined && b.kind === 'building') removeRepairer(b, unit.id);
  },
};

/**
 * Own completed building with hp < max (`invalidTarget` otherwise: full hp, unfinished, foreign, not a building);
 * every unit can build that type (`cannotPerform`). `unknownEntity` for a missing building. Units are validated
 * first (`validateOwnUnits`), so the first failing unit id decides.
 */
export const applyRepairCommand: CommandHandler<'repair'> = (ctx, cmd) => {
  const units = validateOwnUnits(ctx, cmd, cmd.unitIds);
  if (units === null || units.length === 0) return;
  const b = findEntity(ctx.state, cmd.buildingId);
  if (b === undefined) return reject(ctx, cmd, 'unknownEntity');
  if (b.kind !== 'building' || b.owner !== cmd.playerId || !b.constructed || b.hp <= 0) {
    return reject(ctx, cmd, 'invalidTarget');
  }
  if (b.hp >= buildingCombat(ctx, b.owner, b.typeId).maxHp) return reject(ctx, cmd, 'invalidTarget');
  for (const u of units) {
    const udef = ctx.data.def(u.typeId);
    if (udef === undefined || udef.kind !== 'unit' || !(udef.builds ?? []).includes(b.typeId)) {
      return reject(ctx, cmd, 'cannotPerform');
    }
  }
  for (const u of units) assignOrder(ctx, u, { type: 'repair', buildingId: b.id }, cmd.queue);
};
