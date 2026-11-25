/** `gather` order and command (plan 4.4). Owned by WP6. */

import { findEntity } from '../../entities';
import { isAdjacentToFootprint } from '../../path/approach';
import { followPath } from '../../path/follow';
import { TICK_RATE, type GatherOrderState, type SimContext, type UnitEntity } from '../../types';
import { emit, reject, type CommandHandler } from '../common';
import {
  buildingSize,
  carryCapacity,
  claimSlot,
  depositCarried,
  dropOffBuilding,
  findRetarget,
  gatherRate,
  gatherTargetOf,
  hasRoom,
  nearestDropOff,
  releaseSlot,
} from '../gatherTargets';
import { assignOrder, validateOwnUnits, type OrderHandler, type OrderStep } from './index';

/** Absorbs float drift so that e.g. 50 additions of 0.02 count as 1. */
const ACCUMULATOR_EPSILON = 1e-9;

function toPhase(unit: UnitEntity, state: GatherOrderState, phase: GatherOrderState['phase']): void {
  state.phase = phase;
  unit.path = null;
  unit.pendingPathRequestId = null;
}

/** Nothing left to gather: finish, and tell the player if the unit is now truly idle. */
function goIdle(ctx: SimContext, unit: UnitEntity): OrderStep {
  if (unit.orderQueue.length === 0) emit(ctx, { type: 'VillagerIdle', playerId: unit.owner, unitId: unit.id });
  return 'done';
}

/** Choose the drop-off and start walking to it; `false` if there is none. */
function startDropOff(ctx: SimContext, unit: UnitEntity, state: GatherOrderState): boolean {
  const b = nearestDropOff(ctx, unit, state.resource);
  if (b === null) return false;
  state.dropOffId = b.id;
  toPhase(unit, state, 'toDropOff');
  return true;
}

/**
 * Make sure the order holds a slot on a valid target: keep the current one if
 * it is still gatherable and has room, else retarget around the anchor.
 * Returns false when nothing is left.
 */
function acquire(ctx: SimContext, unit: UnitEntity, state: GatherOrderState): boolean {
  const current = gatherTargetOf(ctx, findEntity(ctx.state, state.targetId), unit.owner);
  if (current !== null && hasRoom(current, unit.id) && gatherRate(ctx, unit, current.kind) > 0) {
    claimSlot(current, unit.id);
    return true;
  }
  releaseSlot(ctx, state.targetId, unit.id);
  const next = findRetarget(ctx, unit, state.anchor, state.resource);
  if (next === null) return false;
  state.targetId = next.entity.id;
  state.anchor = next.centre;
  claimSlot(next, unit.id);
  return true;
}

export const gatherOrderHandler: OrderHandler<'gather'> = {
  begin: (ctx, unit, order) => {
    const target = gatherTargetOf(ctx, findEntity(ctx.state, order.targetId), unit.owner);
    if (target === null || gatherRate(ctx, unit, target.kind) <= 0) return null;
    // Switching resource type discards the load.
    if (unit.carried !== null && unit.carried.type !== target.resource) unit.carried = null;
    return {
      type: 'gather',
      targetId: order.targetId,
      phase: 'start',
      resource: target.resource,
      anchor: target.centre,
      dropOffId: null,
      harvestAccumulator: 0,
    };
  },

  run: (ctx, unit, state) => {
    switch (state.phase) {
      case 'start': {
        if (!acquire(ctx, unit, state)) {
          // Nothing to gather: deliver what is carried first, then go idle.
          if (unit.carried !== null && startDropOff(ctx, unit, state)) return 'running';
          return goIdle(ctx, unit);
        }
        if (unit.carried !== null && unit.carried.amount >= carryCapacity(ctx, unit)) {
          if (startDropOff(ctx, unit, state)) return 'running';
          return goIdle(ctx, unit);
        }
        toPhase(unit, state, 'toNode');
        return 'running';
      }

      case 'toNode': {
        const target = gatherTargetOf(ctx, findEntity(ctx.state, state.targetId), unit.owner);
        if (target === null) {
          toPhase(unit, state, 'start');
          return 'running';
        }
        if (isAdjacentToFootprint(unit.pos, target.tile, target.size)) {
          toPhase(unit, state, 'harvesting');
          return 'running';
        }
        const status = followPath(ctx, unit, { kind: 'footprint', tile: target.tile, size: target.size });
        // Path used up without reaching the target: it cannot be reached.
        if (status === 'arrived' && !isAdjacentToFootprint(unit.pos, target.tile, target.size)) {
          return goIdle(ctx, unit);
        }
        return 'running';
      }

      case 'harvesting': {
        const target = gatherTargetOf(ctx, findEntity(ctx.state, state.targetId), unit.owner);
        if (target === null) {
          toPhase(unit, state, 'start'); // depleted or removed: retarget (or deliver and idle)
          return 'running';
        }
        const capacity = carryCapacity(ctx, unit);
        state.harvestAccumulator += gatherRate(ctx, unit, target.kind) / TICK_RATE;
        let carried = unit.carried;
        while (state.harvestAccumulator + ACCUMULATOR_EPSILON >= 1) {
          if ((carried?.amount ?? 0) >= capacity) break;
          if (target.entity.kind === 'node' && target.entity.amount <= 0) break;
          state.harvestAccumulator = Math.max(0, state.harvestAccumulator - 1);
          if (target.entity.kind === 'node') target.entity.amount -= 1;
          if (carried === null) {
            carried = { type: state.resource, amount: 0 };
            unit.carried = carried;
          }
          carried.amount += 1;
        }
        if (carried !== null && carried.amount >= capacity) {
          state.harvestAccumulator = Math.min(state.harvestAccumulator, 1 - ACCUMULATOR_EPSILON);
          if (startDropOff(ctx, unit, state)) return 'running';
          return goIdle(ctx, unit);
        }
        return 'running';
      }

      case 'toDropOff': {
        const carried = unit.carried;
        if (carried === null) {
          toPhase(unit, state, 'start');
          return 'running';
        }
        let building = state.dropOffId === null ? null : dropOffBuilding(ctx, state.dropOffId, unit.owner, carried.type);
        if (building === null) {
          // Drop-off was destroyed or never valid: pick again, else give up.
          if (!startDropOff(ctx, unit, state)) return goIdle(ctx, unit);
          building = dropOffBuilding(ctx, state.dropOffId as number, unit.owner, carried.type);
          if (building === null) return goIdle(ctx, unit);
        }
        const size = buildingSize(ctx, building);
        if (isAdjacentToFootprint(unit.pos, building.tile, size)) {
          depositCarried(ctx, unit);
          state.dropOffId = null;
          toPhase(unit, state, 'start');
          return 'running';
        }
        const status = followPath(ctx, unit, { kind: 'footprint', tile: building.tile, size });
        if (status === 'arrived' && !isAdjacentToFootprint(unit.pos, building.tile, size)) return goIdle(ctx, unit);
        return 'running';
      }
    }
  },

  end: (ctx, unit, state) => {
    releaseSlot(ctx, state.targetId, unit.id);
  },
};

/**
 * Gather from a resource node or a completed own farm. All-or-nothing:
 * the units are validated like any order (`validateOwnUnits`); the target must
 * exist (`unknownEntity`), be a node with something left or a farm
 * (`invalidTarget`), an own farm (`notOwner`), completed (`notConstructed`);
 * every unit must be able to gather that kind (`cannotPerform`).
 * A full node is accepted: the order retargets when it begins.
 */
export const applyGatherCommand: CommandHandler<'gather'> = (ctx, cmd) => {
  const units = validateOwnUnits(ctx, cmd, cmd.unitIds);
  if (units === null || units.length === 0) return;
  const entity = findEntity(ctx.state, cmd.nodeId);
  if (entity === undefined) return reject(ctx, cmd, 'unknownEntity');
  if (entity.kind === 'unit') return reject(ctx, cmd, 'invalidTarget');
  if (entity.kind === 'node') {
    if (entity.amount <= 0) return reject(ctx, cmd, 'invalidTarget');
  } else {
    const def = ctx.data.def(entity.typeId);
    if (def === undefined || def.kind !== 'building' || def.farm === undefined) return reject(ctx, cmd, 'invalidTarget');
    if (entity.owner !== cmd.playerId) return reject(ctx, cmd, 'notOwner');
    if (!entity.constructed) return reject(ctx, cmd, 'notConstructed');
  }
  const target = gatherTargetOf(ctx, entity, cmd.playerId);
  if (target === null) return reject(ctx, cmd, 'invalidTarget');
  for (const unit of units) {
    if (gatherRate(ctx, unit, target.kind) <= 0) return reject(ctx, cmd, 'cannotPerform');
  }
  for (const unit of units) assignOrder(ctx, unit, { type: 'gather', targetId: cmd.nodeId }, cmd.queue);
};
