/** Population (plan 4.6). Owned by WP8. */

import { resolvedStat } from '../rules/stats';
import { recordStat } from './matchStats';
import { POP_HARD_CAP, type PlayerId, type SimContext } from '../types';

/** Sum of `popCost` of the player's living units (not units in production). */
export function livingPopulation(ctx: SimContext, playerId: PlayerId): number {
  let total = 0;
  for (const e of ctx.state.entities) {
    if (e.kind === 'unit' && e.owner === playerId && ctx.data.def(e.typeId) !== undefined) {
      total += resolvedStat(ctx, playerId, e.typeId, 'popCost');
    }
  }
  return total;
}

/**
 * Recompute every player's `popUsed` (living units only; queued units do not count) and
 * `popCap` (min(POP_HARD_CAP, completed buildings' popProvided)).
 * Called from cleanup (tick step 8) and after load.
 */
export function recomputePopulation(ctx: SimContext): void {
  const { state } = ctx;
  const used: number[] = state.players.map(() => 0);
  const cap: number[] = state.players.map(() => 0);
  for (const e of state.entities) {
    if (e.owner <= 0 || e.owner >= used.length) continue;
    if (e.kind === 'unit') {
      if (ctx.data.def(e.typeId) !== undefined) used[e.owner]! += resolvedStat(ctx, e.owner, e.typeId, 'popCost');
    } else if (e.kind === 'building') {
      if (ctx.data.def(e.typeId) === undefined) continue;
      if (e.constructed) cap[e.owner]! += resolvedStat(ctx, e.owner, e.typeId, 'popProvided');
    }
  }
  for (const p of state.players) {
    if (p.id === 0) continue;
    const popUsed = used[p.id]!;
    p.popUsed = popUsed;
    p.popCap = Math.min(POP_HARD_CAP, cap[p.id]!);
    if (popUsed > p.stats.peakPopulation) {
      recordStat(ctx, p.id, (s) => {
        s.peakPopulation = popUsed;
      });
    }
  }
}
