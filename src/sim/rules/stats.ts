/** Stat resolution through modifiers (plan 4.7). Owned by WP8. */

import type { DefId, PlayerId, SimContext, StatKey } from '../types';

/**
 * Resolved value of `stat` for `defId` as owned by `playerId`:
 * base -> civ modifiers -> tech modifiers; all `add` before all `mul`.
 * Reads the cache in `ctx.runtime.resolvedStats`. STUB: throws.
 */
export function resolvedStat(_ctx: SimContext, playerId: PlayerId, defId: DefId, stat: StatKey): number {
  throw new Error(`resolvedStat not implemented (player ${playerId}, ${defId}, ${stat})`);
}

/** Rebuild the resolved-stat cache for one player. STUB: clears it. */
export function rebuildResolvedStats(ctx: SimContext, playerId: PlayerId): void {
  ctx.runtime.resolvedStats[playerId] = {};
}

/** Rebuild the resolved-stat cache for every player. */
export function rebuildAllResolvedStats(ctx: SimContext): void {
  for (const player of ctx.state.players) rebuildResolvedStats(ctx, player.id);
}
