/** Tile snapping for building placement (pure). */

import type { TilePos, Vec2 } from '../../../sim/types';

/**
 * Top-left tile of a `size` x `size` footprint whose centre is nearest to the
 * world point (wx, wy). Odd sizes centre on a tile centre, even sizes on a tile
 * corner, so the footprint is always centred under the cursor.
 */
export function snapFootprint(wx: number, wy: number, size: number): TilePos {
  return { tx: Math.round(wx - size / 2), ty: Math.round(wy - size / 2) };
}

/** World centre of a footprint with top-left tile (tx, ty). */
export function footprintCentre(tx: number, ty: number, size: number): Vec2 {
  return { x: tx + size / 2, y: ty + size / 2 };
}
