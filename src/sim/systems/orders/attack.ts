/** `attack` order and command (PLAN-M2 3.3, 4.5, 4.6, 4.8). Owned by WP21 (Combat core). */

import { notImplemented, type CommandHandler } from '../common';
import type { OrderHandler } from './index';

/**
 * Attack one entity: chase it (no leash for commanded attacks; leash around `anchor` for `auto` ones) and stand in
 * phase `attacking` while it is in reach; done when it is gone.
 *
 * STUB (TODO(WP21)): `begin` returns null, so a queued attack order is skipped.
 */
export const attackOrderHandler: OrderHandler<'attack'> = {
  begin: () => null,
  run: () => 'done',
  end: () => {},
};

/**
 * All-or-nothing (`validateOwnUnits`): target exists (`unknownEntity`), is an enemy with hp > 0 (`invalidTarget`),
 * every unit can target it (`cannotPerform`).
 *
 * STUB (TODO(WP21)): rejects with `invalidCommand`.
 */
export const applyAttackCommand: CommandHandler<'attack'> = (ctx, cmd) => {
  notImplemented(ctx, cmd);
};
