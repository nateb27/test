/**
 * Acquisition (PLAN-M2 4.5): tick step 4. Owned by WP21 (Combat core).
 */

import { ACQUIRE_BUDGET_PER_TICK, type SimContext } from '../../types';
import { rebuildSpatialIndex } from './spatial';

/**
 * Step 4: rebuild the spatial index, reset `runtime.acquireBudget`, then run the target scans of due units and
 * buildings (staggered by `combat.nextScanTick`, budgets in checks, tiers of 4.5).
 *
 * STUB (TODO(WP21)): rebuilds the (stub) index and resets the budget; scans nothing.
 */
export function runAcquisition(ctx: SimContext): void {
  rebuildSpatialIndex(ctx);
  ctx.runtime.acquireBudget = ACQUIRE_BUDGET_PER_TICK;
}
