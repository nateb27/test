/**
 * Death (PLAN-M2 2.5, 4.9): tick step 11, before the existing cleanup. Owned by WP23 (Death and outcome).
 */

import type { SimContext } from '../types';

/**
 * Step 11: every unit and building with `hp <= 0` emits `UnitDied` / `BuildingDestroyed` (kill credit from
 * `lastAttackerId`, else a still-flying projectile's owner), updates stats through `recordStat`, has its queue
 * discarded without refund (buildings) and is added to `runtime.pendingRemoval`.
 *
 * STUB (TODO(WP23)): no-op (entities at 0 hp stay in the game).
 */
export function runDeath(_ctx: SimContext): void {
  // STUB: replaced by WP23.
}
