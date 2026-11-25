/** Tick step 7 (construction progress), build and cancelConstruction commands. Owned by WP7. */

import { notImplemented, type CommandHandler } from './common';
import type { SimContext } from '../types';

/**
 * Advance every unfinished building by its builders:
 * speed multiplier `1 + 0.5 * (n - 1)` for n builders; completion emits
 * BuildingCompleted. STUB: does nothing.
 */
export function runConstruction(_ctx: SimContext): void {
  // Implemented by WP7.
}

/** Validate with canPlace, deduct cost, create the foundation, assign build orders. STUB: rejects. */
export const applyBuildCommand: CommandHandler<'build'> = (ctx, cmd) => notImplemented(ctx, cmd);

/** STUB: rejects. */
export const applyCancelConstructionCommand: CommandHandler<'cancelConstruction'> = (ctx, cmd) =>
  notImplemented(ctx, cmd);
