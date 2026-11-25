/**
 * Line-of-sight path smoothing (plan 4.3). Owned by WP2.
 *
 * `lineWalkable` walks every tile touched by the straight segment between
 * two tile centres using integer steps only (a supercover grid walk; the
 * step choice compares `(1 + 2 * ix) * ny` with `(1 + 2 * iy) * nx`). When
 * the segment passes exactly through a tile corner, both tiles beside the
 * corner must be walkable too, mirroring A*'s no-corner-cutting rule.
 */

import { isWalkable, type PathGrid } from './grid';

/** True if a unit can walk straight from the centre of (ax, ay) to the centre of (bx, by). */
export function lineWalkable(grid: PathGrid, ax: number, ay: number, bx: number, by: number): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const nx = Math.abs(dx);
  const ny = Math.abs(dy);
  const sx = dx > 0 ? 1 : -1;
  const sy = dy > 0 ? 1 : -1;
  let x = ax;
  let y = ay;
  if (!isWalkable(grid, x, y)) return false;
  let ix = 0;
  let iy = 0;
  while (ix < nx || iy < ny) {
    const cmp = (1 + 2 * ix) * ny - (1 + 2 * iy) * nx;
    if (cmp === 0) {
      // Exactly through a corner: the two side tiles and the diagonal tile.
      if (!isWalkable(grid, x + sx, y) || !isWalkable(grid, x, y + sy)) return false;
      x += sx;
      y += sy;
      ix++;
      iy++;
    } else if (cmp < 0) {
      x += sx;
      ix++;
    } else {
      y += sy;
      iy++;
    }
    if (!isWalkable(grid, x, y)) return false;
  }
  return true;
}

/**
 * String-pull a tile path (tile indices, start first): from each kept tile,
 * jump to the farthest following tile still in straight-line sight. The
 * first and last tiles are always kept, and every consecutive pair of kept
 * tiles satisfies `lineWalkable`.
 */
export function smoothPath(grid: PathGrid, tiles: readonly number[]): number[] {
  const n = tiles.length;
  if (n <= 2) return tiles.slice();
  const w = grid.width;
  const out: number[] = [tiles[0]!];
  let anchor = 0;
  while (anchor < n - 1) {
    const a = tiles[anchor]!;
    const ax = a % w;
    const ay = (a - ax) / w;
    let k = anchor + 1;
    while (k + 1 < n) {
      const b = tiles[k + 1]!;
      const bx = b % w;
      const by = (b - bx) / w;
      if (!lineWalkable(grid, ax, ay, bx, by)) break;
      k++;
    }
    out.push(tiles[k]!);
    anchor = k;
  }
  return out;
}
