/** Tick step 9 (first half): objectives (plan 4.8). Owned by WP8. */

import { emit } from './common';
import type { SimContext } from '../types';

/**
 * Mark objectives complete (setting `completedTick`) and emit
 * ObjectiveCompleted once. `completedTick` and the event's `tick` are the
 * number of ticks elapsed including the current one (`state.tick + 1`, since
 * the tick counter is incremented after this step).
 */
export function runObjectives(ctx: SimContext): void {
  for (const entry of ctx.state.objectives.entries) {
    if (entry.completedTick !== null) continue;
    const player = ctx.state.players[entry.playerId];
    if (player === undefined) continue;
    if (entry.kind === 'reachAge' && player.age >= entry.targetAge) {
      entry.completedTick = ctx.state.tick + 1;
      emit(ctx, {
        type: 'ObjectiveCompleted',
        playerId: entry.playerId,
        objectiveId: entry.id,
        tick: entry.completedTick,
      });
    }
  }
}
