/** Approach tiles (plan 4.3). Owned by WP2. */

import type { SimContext, TilePos, Vec2 } from '../types';

/**
 * Nearest reachable walkable tile adjacent to the square footprint at `tile`
 * with side `size`, measured from `from`; ties by lowest tile index.
 * Used for gathering, building, dropping off, spawning and rallying.
 * Returns `null` if none exists. STUB: always `null`.
 */
export function approachTile(
  _ctx: SimContext,
  _from: Vec2,
  _tile: TilePos,
  _size: number,
): TilePos | null {
  return null;
}
