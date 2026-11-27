/**
 * Outcome (PLAN-M2 4.13): tick step 12 (before objectives) and the `resign` command. Owned by WP23.
 */

import { notImplemented, type CommandHandler } from './common';
import type { SimContext } from '../types';

/**
 * Step 12 (conquest mode only): defeat checks for `playing` players, destruction of defeated players' entities
 * (`hp = 0`, they die in step 11 of the next tick), victory or draw (`match.winner`, `endedTick`, `MatchEnded`,
 * `ObjectiveCompleted('conquest:<id>')`).
 *
 * STUB (TODO(WP23)): no-op. Note that the `defeat` cheat (cheats.ts) already sets `outcome`/`defeatedTick` and emits
 * `PlayerDefeated`; this step is where the defeated player's entities are then destroyed and the winner decided.
 */
export function runOutcome(_ctx: SimContext): void {
  // STUB: replaced by WP23.
}

/**
 * Resign: accepted while the player is `playing` (else `playerDefeated`); sets `outcome = 'defeated'`,
 * `defeatedTick = tick + 1` and emits `PlayerDefeated{reason: 'resigned'}` at once; destruction happens in step 12.
 *
 * STUB (TODO(WP23)): rejects with `invalidCommand`.
 */
export const applyResignCommand: CommandHandler<'resign'> = (ctx, cmd) => {
  notImplemented(ctx, cmd);
};
