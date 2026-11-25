/** Occupancy grid. Owned by WP1. */

import type { DataRegistry } from '../../data/schema';
import type { GameState } from '../types';

/**
 * Build the occupancy grid from state: one byte per tile, row-major,
 * non-zero where a blocking building (including foundations) or blocking node
 * stands. STUB: returns an all-free grid.
 */
export function buildOccupancy(state: GameState, _data: DataRegistry): Uint8Array {
  return new Uint8Array(state.map.width * state.map.height);
}
