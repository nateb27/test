/** Tick step 2 (production and research queues), train/cancelQueue/setRally. Owned by WP8. */

import { notImplemented, type CommandHandler } from './common';
import type { SimContext } from '../types';

/**
 * Advance the front item of every completed building's queue by one tick
 * (instantly if the owner has the instantResearch cheat). Finished units
 * spawn (or hold at the pop cap); finished techs call `completeResearch`.
 * STUB: does nothing.
 */
export function runProduction(_ctx: SimContext): void {
  // Implemented by WP8.
}

/** STUB: rejects. */
export const applyTrainCommand: CommandHandler<'train'> = (ctx, cmd) => notImplemented(ctx, cmd);
/** STUB: rejects. */
export const applyCancelQueueCommand: CommandHandler<'cancelQueue'> = (ctx, cmd) => notImplemented(ctx, cmd);
/** STUB: rejects. */
export const applySetRallyCommand: CommandHandler<'setRally'> = (ctx, cmd) => notImplemented(ctx, cmd);
