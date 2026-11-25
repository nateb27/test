/**
 * The walkability grid seen by pathfinding (plan 4.3). Owned by WP2.
 *
 * Pure pathfinding functions take a `PathGrid` argument so they can be tested
 * without a full sim. `gridOf(ctx)` wraps the runtime occupancy grid.
 */

import type { SimContext, TilePos, Vec2 } from '../types';

export interface PathGrid {
  readonly width: number;
  readonly height: number;
  /** One entry per tile, row-major: 0 = walkable, non-zero = blocked. */
  readonly blocked: ArrayLike<number>;
  /**
   * Changes whenever `blocked` changes (the sim uses `occupancyVersion`).
   * Only used to key derived caches (connected components).
   */
  readonly version: number;
}

/** The sim's current grid: runtime occupancy + `state.occupancyVersion`. */
export function gridOf(ctx: SimContext): PathGrid {
  return {
    width: ctx.state.map.width,
    height: ctx.state.map.height,
    blocked: ctx.runtime.occupancy,
    version: ctx.state.occupancyVersion,
  };
}

export function inBounds(grid: PathGrid, tx: number, ty: number): boolean {
  return tx >= 0 && ty >= 0 && tx < grid.width && ty < grid.height;
}

/** In bounds and not blocked. */
export function isWalkable(grid: PathGrid, tx: number, ty: number): boolean {
  return inBounds(grid, tx, ty) && grid.blocked[ty * grid.width + tx] === 0;
}

/** Tile containing a world point, clamped into the map. */
export function tileAt(grid: PathGrid, x: number, y: number): TilePos {
  return {
    tx: Math.min(grid.width - 1, Math.max(0, Math.floor(x))),
    ty: Math.min(grid.height - 1, Math.max(0, Math.floor(y))),
  };
}

/** Centre of a tile in world space. */
export function tileCentre(tx: number, ty: number): Vec2 {
  return { x: tx + 0.5, y: ty + 0.5 };
}

/** Largest coordinate strictly inside a map side of `size` tiles. */
const EDGE_EPSILON = 1 / 1024;

/** Clamp a world point into the map (strictly inside the last tile). */
export function clampPoint(grid: PathGrid, x: number, y: number): Vec2 {
  return {
    x: Math.min(grid.width - EDGE_EPSILON, Math.max(0, x)),
    y: Math.min(grid.height - EDGE_EPSILON, Math.max(0, y)),
  };
}

// ---------------------------------------------------------------------------
// Connected components (derived cache, never in state)
// ---------------------------------------------------------------------------

interface ComponentCache {
  version: number;
  width: number;
  height: number;
  labels: Int32Array;
}

const componentCache = new WeakMap<object, ComponentCache>();

/**
 * Connected-component label per tile under 8-connected movement without
 * corner cutting (the same moves A* makes). Blocked tiles get -1. Cached per
 * `blocked` array and `version`; the result is a pure function of the grid.
 */
export function componentLabels(grid: PathGrid): Int32Array {
  const key = grid.blocked as object;
  const cached = componentCache.get(key);
  if (
    cached !== undefined &&
    cached.version === grid.version &&
    cached.width === grid.width &&
    cached.height === grid.height
  ) {
    return cached.labels;
  }
  const { width, height } = grid;
  const n = width * height;
  const labels = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);
  let next = 0;
  for (let i = 0; i < n; i++) {
    if (labels[i] !== -1 || grid.blocked[i] !== 0) continue;
    const label = next++;
    labels[i] = label;
    let sp = 0;
    stack[sp++] = i;
    while (sp > 0) {
      const cur = stack[--sp]!;
      const cx = cur % width;
      const cy = (cur - cx) / width;
      for (let d = 0; d < 8; d++) {
        const nx = cx + DIR_X[d]!;
        const ny = cy + DIR_Y[d]!;
        if (!canStep(grid, cx, cy, nx, ny)) continue;
        const ni = ny * width + nx;
        if (labels[ni] !== -1) continue;
        labels[ni] = label;
        stack[sp++] = ni;
      }
    }
  }
  componentCache.set(key, { version: grid.version, width, height, labels });
  return labels;
}

// ---------------------------------------------------------------------------
// Moves
// ---------------------------------------------------------------------------

/** The 8 neighbour offsets in a fixed order: orthogonals first, then diagonals. */
export const DIR_X: readonly number[] = [1, 0, -1, 0, 1, -1, -1, 1];
export const DIR_Y: readonly number[] = [0, 1, 0, -1, 1, 1, -1, -1];

/**
 * Can a unit step from tile (x, y) to the neighbouring tile (nx, ny)?
 * The target must be walkable; a diagonal step additionally needs both
 * orthogonal tiles it passes walkable (no corner cutting).
 */
export function canStep(grid: PathGrid, x: number, y: number, nx: number, ny: number): boolean {
  if (!isWalkable(grid, nx, ny)) return false;
  if (nx !== x && ny !== y) {
    return isWalkable(grid, nx, y) && isWalkable(grid, x, ny);
  }
  return true;
}
