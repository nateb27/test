/** `attackMove` order and command (PLAN-M2 3.3, 4.5, 4.6, 4.8). Owned by WP21 (Combat core). */

import { notImplemented, type CommandHandler } from '../common';
import type { OrderHandler } from './index';

/**
 * Walk to a point, engaging enemies met on the way (leash around the engagement anchor), then continue walking.
 *
 * STUB (TODO(WP21)): `begin` returns null, so a queued attack-move order is skipped.
 */
export const attackMoveOrderHandler: OrderHandler<'attackMove'> = {
  begin: () => null,
  run: () => 'done',
  end: () => {},
};

/**
 * Finite point inside the map, expanded into group slots exactly like `move`; else `invalidCommand`.
 *
 * STUB (TODO(WP21)): rejects with `invalidCommand`.
 */
export const applyAttackMoveCommand: CommandHandler<'attackMove'> = (ctx, cmd) => {
  notImplemented(ctx, cmd);
};
