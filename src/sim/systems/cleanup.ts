/** Tick step 8: cleanup, and the delete command. Owned by WP1. */

import { notImplemented, type CommandHandler } from './common';
import { recomputePopulation } from './population';
import type { SimContext } from '../types';

/**
 * Remove depleted nodes and entities in `runtime.pendingRemoval` (ending
 * their units' orders and releasing slots), update occupancy and
 * occupancyVersion, then recompute population.
 * STUB: clears pendingRemoval and recomputes population.
 */
export function runCleanup(ctx: SimContext): void {
  ctx.runtime.pendingRemoval.length = 0;
  recomputePopulation(ctx);
}

/** STUB: rejects. */
export const applyDeleteCommand: CommandHandler<'delete'> = (ctx, cmd) => notImplemented(ctx, cmd);
