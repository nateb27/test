/** `hold` order and command (PLAN-M2 3.3, 4.5, 4.8). Owned by WP21 (Combat core). */

import { unitCombat } from '../combat/damage';
import { inReach, standStill, targetFor } from '../combat/engage';
import type { CommandHandler } from '../common';
import { assignOrder, validateOwnUnits, type OrderHandler } from './index';

/**
 * Never move; attack the best target in reach (chosen by acquisition, re-scanning each interval). A target that dies
 * or leaves reach is dropped and the unit scans again next tick. Lasts until replaced.
 */
export const holdOrderHandler: OrderHandler<'hold'> = {
  begin: (_ctx, unit) => {
    standStill(unit);
    return { type: 'hold', phase: 'holding', targetId: null };
  },
  run: (ctx, unit, state) => {
    standStill(unit);
    if (state.targetId !== null) {
      const profile = unitCombat(ctx, unit.owner, unit.typeId);
      const target = targetFor(ctx, unit, profile, state.targetId);
      if (target === undefined || !inReach(ctx, unit, profile, target)) {
        state.targetId = null;
        unit.combat.nextScanTick = Math.min(unit.combat.nextScanTick, ctx.state.tick + 1);
      }
    }
    return 'running';
  },
  end: () => {},
};

/** Units exist (all-or-nothing through `validateOwnUnits`); replaces their orders with `hold`. */
export const applyHoldCommand: CommandHandler<'hold'> = (ctx, cmd) => {
  const units = validateOwnUnits(ctx, cmd, cmd.unitIds);
  if (units === null) return;
  for (const unit of units) assignOrder(ctx, unit, { type: 'hold' }, false);
};
