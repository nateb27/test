/**
 * Derived runtime caches (see SimRuntime in types.ts). Owned by WP20 in M2, then the orchestrator.
 */

import { buildOccupancy } from './map/occupancy';
import { rebuildAllResolvedStats } from './rules/stats';
import { createSpatialIndex } from './systems/combat/spatial';
import type { DataRegistry } from '../data/schema';
import { ACQUIRE_BUDGET_PER_TICK, type GameState, type SimRuntime } from './types';

/** Rebuild every derived cache from state. Called on create and on load. */
export function rebuildRuntime(state: GameState, data: DataRegistry): SimRuntime {
  const runtime: SimRuntime = {
    occupancy: buildOccupancy(state, data),
    resolvedStats: state.players.map(() => ({})),
    pendingRemoval: [],
    combat: state.players.map(() => ({})),
    spatial: createSpatialIndex(state.map.width, state.map.height),
    acquireBudget: ACQUIRE_BUDGET_PER_TICK,
  };
  rebuildAllResolvedStats({ state, runtime, data, events: [] });
  return runtime;
}
