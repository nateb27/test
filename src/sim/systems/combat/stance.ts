/**
 * The `setStance` command (PLAN-M2 4.5, 4.8). Owned by WP21 (Combat core).
 */

import type { CommandHandler } from '../common';
import { validateOwnUnits } from '../orders/index';

/** Set the stance of own units (all-or-nothing through `validateOwnUnits`); the current order is unchanged. */
export const applySetStanceCommand: CommandHandler<'setStance'> = (ctx, cmd) => {
  const units = validateOwnUnits(ctx, cmd, cmd.unitIds);
  if (units === null) return;
  for (const unit of units) unit.stance = cmd.stance;
};
