/** `repair` order and command (PLAN-M2 3.3, 4.8, 4.12). Owned by WP24 (Repair, movement and map). */

import { notImplemented, type CommandHandler } from '../common';
import type { OrderHandler } from './index';

/**
 * Walk to the footprint like `assist`; in phase `repairing` the unit is adjacent and listed in the building's
 * `repairerIds`; done at max hp (VillagerIdle if nothing is queued) or when the building is gone.
 *
 * STUB (TODO(WP24)): `begin` returns null, so a queued repair order is skipped.
 */
export const repairOrderHandler: OrderHandler<'repair'> = {
  begin: () => null,
  run: () => 'done',
  end: () => {},
};

/**
 * Own completed building with hp < max (`invalidTarget` otherwise); every unit can build that type
 * (`cannotPerform`).
 *
 * STUB (TODO(WP24)): rejects with `invalidCommand`.
 */
export const applyRepairCommand: CommandHandler<'repair'> = (ctx, cmd) => {
  notImplemented(ctx, cmd);
};
