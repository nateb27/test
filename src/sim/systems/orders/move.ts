/** `move` order and command. Owned by WP2. */

import { followPath } from '../../path/follow';
import { gridOf } from '../../path/grid';
import { groupSlots } from '../../path/slots';
import { reject, type CommandHandler } from '../common';
import { assignOrder, validateOwnUnits, type OrderHandler } from './index';
import type { UnitEntity, Vec2 } from '../../types';

export const moveOrderHandler: OrderHandler<'move'> = {
  begin: (_ctx, _unit, order) => ({ type: 'move', x: order.x, y: order.y, phase: 'start' }),
  run: (ctx, unit, state) => {
    const status = followPath(ctx, unit, { kind: 'point', x: state.x, y: state.y });
    state.phase = 'walking';
    return status === 'arrived' ? 'done' : 'running';
  },
  end: () => {},
};

/**
 * Pair units with destination slots: units sorted by squared distance to the
 * clicked point (ties by lowest id) take slots in order, so the nearest unit
 * gets the clicked point. If there are fewer slots than units, slots repeat.
 */
export function assignSlots(units: readonly UnitEntity[], x: number, y: number, slots: readonly Vec2[]): Vec2[] {
  const order = units
    .map((u, index) => {
      const dx = u.pos.x - x;
      const dy = u.pos.y - y;
      return { index, id: u.id, d: dx * dx + dy * dy };
    })
    .sort((a, b) => a.d - b.d || a.id - b.id);
  const result: Vec2[] = new Array<Vec2>(units.length);
  order.forEach((entry, k) => {
    const slot = slots.length === 0 ? { x, y } : slots[k % slots.length]!;
    result[entry.index] = { x: slot.x, y: slot.y };
  });
  return result;
}

/**
 * Validates the units (see `validateOwnUnits`) and the target, expands the
 * target into group slots and gives each unit a `move` order to its slot.
 * `queue` appends to each unit's order queue instead of replacing it.
 */
export const applyMoveCommand: CommandHandler<'move'> = (ctx, cmd) => {
  if (!Number.isFinite(cmd.x) || !Number.isFinite(cmd.y)) {
    reject(ctx, cmd, 'invalidCommand');
    return;
  }
  const units = validateOwnUnits(ctx, cmd, cmd.unitIds);
  if (units === null || units.length === 0) return;
  const slots = groupSlots(gridOf(ctx), cmd.x, cmd.y, units.length);
  const targets = assignSlots(units, cmd.x, cmd.y, slots);
  units.forEach((unit, k) => {
    const t = targets[k]!;
    assignOrder(ctx, unit, { type: 'move', x: t.x, y: t.y }, cmd.queue);
  });
};
