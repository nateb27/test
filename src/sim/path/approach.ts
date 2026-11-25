/** Approach tiles (plan 4.3). Owned by WP2. */

import { componentLabels, gridOf, isWalkable, tileAt, type PathGrid } from './grid';
import type { SimContext, TilePos, Vec2 } from '../types';

/**
 * Nearest reachable walkable tile adjacent to the square footprint at `tile`
 * with side `size`, measured from `from`; ties by lowest tile index.
 * Used for gathering, building, dropping off, spawning and rallying.
 * Returns `null` if none exists.
 */
export function approachTile(ctx: SimContext, from: Vec2, tile: TilePos, size: number): TilePos | null {
  return approachTileOnGrid(gridOf(ctx), from, tile, size);
}

/**
 * Pure version of `approachTile` on an explicit grid.
 *
 * Candidates are the walkable tiles of the 8-connected ring around the
 * footprint (corners included). "Reachable" means in the same connected
 * component as the tile containing `from`; if that tile is itself blocked
 * (e.g. `from` is a building's centre when spawning), any walkable ring tile
 * qualifies. Distance is squared Euclidean from `from` to the tile centre;
 * ties by lowest tile index.
 */
export function approachTileOnGrid(grid: PathGrid, from: Vec2, tile: TilePos, size: number): TilePos | null {
  const origin = tileAt(grid, from.x, from.y);
  const labels = componentLabels(grid);
  const originLabel = labels[origin.ty * grid.width + origin.tx]!;
  let best: TilePos | null = null;
  let bestD = 0;
  let bestI = 0;
  const x0 = tile.tx - 1;
  const y0 = tile.ty - 1;
  const x1 = tile.tx + size;
  const y1 = tile.ty + size;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (x !== x0 && x !== x1 && y !== y0 && y !== y1) continue;
      if (!isWalkable(grid, x, y)) continue;
      const i = y * grid.width + x;
      if (originLabel !== -1 && labels[i] !== originLabel) continue;
      const cx = x + 0.5 - from.x;
      const cy = y + 0.5 - from.y;
      const d = cx * cx + cy * cy;
      if (best === null || d < bestD || (d === bestD && i < bestI)) {
        best = { tx: x, ty: y };
        bestD = d;
        bestI = i;
      }
    }
  }
  return best;
}

/**
 * True if world point `pos` lies in a tile 8-adjacent to the footprint (or
 * inside it). Use it to decide that a unit has arrived at a footprint.
 */
export function isAdjacentToFootprint(pos: Vec2, tile: TilePos, size: number): boolean {
  const tx = Math.floor(pos.x);
  const ty = Math.floor(pos.y);
  return tx >= tile.tx - 1 && tx <= tile.tx + size && ty >= tile.ty - 1 && ty <= tile.ty + size;
}
