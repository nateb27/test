/** `attackMove` order and command (PLAN-M2 3.3, 4.5, 4.6, 4.8). Owned by WP21 (Combat core). */

import { followPath } from '../../path/follow';
import { gridOf } from '../../path/grid';
import { groupSlots } from '../../path/slots';
import type { AttackMoveOrderState, SimContext, UnitEntity } from '../../types';
import { unitCombat } from '../combat/damage';
import { engage, leashBroken, standStill, targetFor } from '../combat/engage';
import { reject, type CommandHandler } from '../common';
import { assignSlots } from './move';
import { assignOrder, validateOwnUnits, type OrderHandler } from './index';

/** Back to walking after an engagement: forget the target and the chase path, scan again next tick. */
function resumeWalking(ctx: SimContext, unit: UnitEntity, state: AttackMoveOrderState): void {
  state.phase = 'walking';
  state.targetId = null;
  state.anchor = null;
  standStill(unit);
  unit.combat.nextScanTick = ctx.state.tick + 1;
}

/**
 * Walk to a point, engaging enemies met on the way (acquisition switches the phase to `engaging`; leash around the
 * engagement anchor), then continue walking. Done on arrival. Stance does not matter (the explicit order wins).
 */
export const attackMoveOrderHandler: OrderHandler<'attackMove'> = {
  begin: (ctx, _unit, order) => ({
    type: 'attackMove',
    x: order.x,
    y: order.y,
    phase: 'start',
    targetId: null,
    anchor: null,
    repathTick: ctx.state.tick,
  }),
  run: (ctx, unit, state) => {
    if (state.phase === 'engaging') {
      const profile = unitCombat(ctx, unit.owner, unit.typeId);
      const target = targetFor(ctx, unit, profile, state.targetId);
      if (target === undefined || (state.anchor !== null && leashBroken(ctx, state.anchor, target))) {
        resumeWalking(ctx, unit, state);
      } else {
        engage(ctx, unit, profile, target, true, state);
        return 'running';
      }
    }
    if (unit.combat.windup > 0) {
      standStill(unit);
      state.phase = 'walking';
      return 'running';
    }
    const status = followPath(ctx, unit, { kind: 'point', x: state.x, y: state.y });
    state.phase = 'walking';
    return status === 'arrived' ? 'done' : 'running';
  },
  end: () => {},
};

/** Finite point inside the map, expanded into group slots exactly like `move`; else `invalidCommand`. */
export const applyAttackMoveCommand: CommandHandler<'attackMove'> = (ctx, cmd) => {
  const { width, height } = ctx.state.map;
  if (!Number.isFinite(cmd.x) || !Number.isFinite(cmd.y) || cmd.x < 0 || cmd.y < 0 || cmd.x >= width || cmd.y >= height) {
    reject(ctx, cmd, 'invalidCommand');
    return;
  }
  const units = validateOwnUnits(ctx, cmd, cmd.unitIds);
  if (units === null || units.length === 0) return;
  const slots = groupSlots(gridOf(ctx), cmd.x, cmd.y, units.length);
  const targets = assignSlots(units, cmd.x, cmd.y, slots);
  units.forEach((unit, k) => {
    const t = targets[k]!;
    assignOrder(ctx, unit, { type: 'attackMove', x: t.x, y: t.y }, cmd.queue);
  });
};
