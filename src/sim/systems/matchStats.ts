/**
 * Match statistics (PLAN-M2 3.2 `PlayerStats`, end screen). Implemented in Phase 0 (WP20); owned by WP23 afterwards.
 *
 * Every counter change goes through `recordStat`, so a system never needs to know where the stats live. Phase 0
 * calls it from: production spawn (unitsTrained), construction complete (buildingsBuilt), drop-off deposit and
 * passive income (resourcesGathered), research complete (techsResearched, ageReachedTick), population recompute
 * (peakPopulation). WP23 adds the death counters (unitsLost/Killed, buildingsLost/Destroyed).
 */

import type { PlayerId, PlayerStats, SimContext } from '../types';

/** Apply `mutate` to the stats of `playerId` (ignored for an unknown player). Values must stay integers. */
export function recordStat(ctx: SimContext, playerId: PlayerId, mutate: (stats: PlayerStats) => void): void {
  const player = ctx.state.players[playerId];
  if (player === undefined) return;
  mutate(player.stats);
}

/** Fresh stats for a new player: all counters 0, age 1 reached at tick 0. */
export function emptyStats(): PlayerStats {
  return {
    unitsTrained: 0,
    unitsLost: 0,
    unitsKilled: 0,
    buildingsBuilt: 0,
    buildingsLost: 0,
    buildingsDestroyed: 0,
    resourcesGathered: { food: 0, wood: 0, gold: 0, stone: 0 },
    techsResearched: 0,
    peakPopulation: 0,
    ageReachedTick: [0, null, null, null],
  };
}
