/**
 * The `setStance` command (PLAN-M2 4.5, 4.8). Owned by WP21 (Combat core).
 */

import { notImplemented, type CommandHandler } from '../common';

/**
 * Set the stance of own units (all-or-nothing through `validateOwnUnits`); the current order is unchanged.
 *
 * STUB (TODO(WP21)): rejects with `invalidCommand`.
 */
export const applySetStanceCommand: CommandHandler<'setStance'> = (ctx, cmd) => {
  notImplemented(ctx, cmd);
};
