/** `hold` order and command (PLAN-M2 3.3, 4.5, 4.8). Owned by WP21 (Combat core). */

import { notImplemented, type CommandHandler } from '../common';
import type { OrderHandler } from './index';

/**
 * Never move; attack the best target in reach, re-scanning each interval. Lasts until replaced.
 *
 * STUB (TODO(WP21)): `begin` returns null, so a queued hold order is skipped.
 */
export const holdOrderHandler: OrderHandler<'hold'> = {
  begin: () => null,
  run: () => 'done',
  end: () => {},
};

/**
 * Units exist (all-or-nothing through `validateOwnUnits`); replaces their orders with `hold`.
 *
 * STUB (TODO(WP21)): rejects with `invalidCommand`.
 */
export const applyHoldCommand: CommandHandler<'hold'> = (ctx, cmd) => {
  notImplemented(ctx, cmd);
};
