/** `dropOff` order and command (plan 4.4). Owned by WP6. */

import { findEntity } from '../../entities';
import { isAdjacentToFootprint } from '../../path/approach';
import { followPath } from '../../path/follow';
import { reject, type CommandHandler } from '../common';
import { buildingSize, depositCarried, dropOffBuilding } from '../gatherTargets';
import { assignOrder, validateOwnUnits, type OrderHandler } from './index';

export const dropOffOrderHandler: OrderHandler<'dropOff'> = {
  /** Invalid (skipped) if the unit carries nothing or the building cannot take it. */
  begin: (ctx, unit, order) => {
    if (unit.carried === null) return null;
    if (dropOffBuilding(ctx, order.buildingId, unit.owner, unit.carried.type) === null) return null;
    return { ...order, phase: 'start' };
  },

  run: (ctx, unit, state) => {
    const carried = unit.carried;
    if (carried === null) return 'done';
    const building = dropOffBuilding(ctx, state.buildingId, unit.owner, carried.type);
    if (building === null) return 'done'; // destroyed meanwhile: keep the load, idle
    const size = buildingSize(ctx, building);
    if (isAdjacentToFootprint(unit.pos, building.tile, size)) {
      depositCarried(ctx, unit);
      return 'done';
    }
    state.phase = 'walking';
    const status = followPath(ctx, unit, { kind: 'footprint', tile: building.tile, size });
    if (status === 'arrived' && !isAdjacentToFootprint(unit.pos, building.tile, size)) return 'done';
    return 'running';
  },

  end: () => {},
};

/**
 * Send units to deposit their load. All-or-nothing: the building must exist
 * (`unknownEntity`), be a building (`invalidTarget`), own (`notOwner`),
 * completed (`notConstructed`); every unit must carry something
 * (`cannotPerform`) that the building accepts (`invalidTarget`).
 */
export const applyDropOffCommand: CommandHandler<'dropOff'> = (ctx, cmd) => {
  const units = validateOwnUnits(ctx, cmd, cmd.unitIds);
  if (units === null || units.length === 0) return;
  const b = findEntity(ctx.state, cmd.buildingId);
  if (b === undefined) return reject(ctx, cmd, 'unknownEntity');
  if (b.kind !== 'building') return reject(ctx, cmd, 'invalidTarget');
  if (b.owner !== cmd.playerId) return reject(ctx, cmd, 'notOwner');
  if (!b.constructed) return reject(ctx, cmd, 'notConstructed');
  for (const unit of units) {
    if (unit.carried === null) return reject(ctx, cmd, 'cannotPerform');
    if (dropOffBuilding(ctx, b.id, cmd.playerId, unit.carried.type) === null) return reject(ctx, cmd, 'invalidTarget');
  }
  for (const unit of units) assignOrder(ctx, unit, { type: 'dropOff', buildingId: b.id }, false);
};
