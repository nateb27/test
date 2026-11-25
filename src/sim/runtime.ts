/**
 * Derived runtime caches (see SimRuntime in types.ts). Owned by WP1.
 */

import { buildOccupancy } from './map/occupancy';
import { rebuildAllResolvedStats } from './rules/stats';
import type { DataRegistry } from '../data/schema';
import type { GameState, SimRuntime } from './types';

/** Rebuild every derived cache from state. Called on create and on load. */
export function rebuildRuntime(state: GameState, data: DataRegistry): SimRuntime {
  const runtime: SimRuntime = {
    occupancy: buildOccupancy(state, data),
    resolvedStats: state.players.map(() => ({})),
    pendingRemoval: [],
  };
  rebuildAllResolvedStats({ state, runtime, data, events: [] });
  return runtime;
}
