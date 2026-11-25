/** Population (plan 4.6). Owned by WP8. */

import type { SimContext } from '../types';

/**
 * Recompute every player's `popUsed` (living units + units in queues) and
 * `popCap` (min(POP_HARD_CAP, completed buildings' popProvided)).
 * Called from cleanup (tick step 8) and after load. STUB: does nothing.
 */
export function recomputePopulation(_ctx: SimContext): void {
  // Implemented by WP8.
}
