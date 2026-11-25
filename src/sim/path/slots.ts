/** Group-move destination slots (plan 4.3). Owned by WP2. */

import { clampPoint, componentLabels, isWalkable, tileAt, tileCentre, type PathGrid } from './grid';
import type { Vec2 } from '../types';

/**
 * Expand a clicked point into `count` distinct destinations, spiralling out
 * from the clicked tile.
 *
 * - Candidate tiles are walkable tiles ordered by squared tile distance from
 *   the clicked tile, ties by lowest tile index.
 * - If the clicked tile is walkable, only tiles in its connected component
 *   qualify (no slots behind walls); otherwise any walkable tile does.
 * - Slot 0 is the exact (clamped) clicked point when its tile is walkable;
 *   every other slot is a tile centre. Each slot is in a different tile.
 * - If the map has fewer qualifying tiles than `count`, the list is shorter.
 */
export function groupSlots(grid: PathGrid, x: number, y: number, count: number): Vec2[] {
  if (count <= 0) return [];
  const point = clampPoint(grid, x, y);
  const c = tileAt(grid, point.x, point.y);
  const labels = componentLabels(grid);
  const clickedWalkable = isWalkable(grid, c.tx, c.ty);
  const label = clickedWalkable ? labels[c.ty * grid.width + c.tx]! : -1;
  const maxR = grid.width + grid.height;

  let chosen: { d: number; i: number }[] = [];
  for (let r = 0; ; r = r === 0 ? 2 : r * 2) {
    // All tiles within squared distance r^2 lie in the (2r+1)^2 box.
    chosen = [];
    const r2 = r * r;
    for (let ty = Math.max(0, c.ty - r); ty <= Math.min(grid.height - 1, c.ty + r); ty++) {
      for (let tx = Math.max(0, c.tx - r); tx <= Math.min(grid.width - 1, c.tx + r); tx++) {
        const d = (tx - c.tx) * (tx - c.tx) + (ty - c.ty) * (ty - c.ty);
        if (d > r2) continue;
        const i = ty * grid.width + tx;
        if (grid.blocked[i] !== 0) continue;
        if (label !== -1 && labels[i] !== label) continue;
        chosen.push({ d, i });
      }
    }
    if (chosen.length >= count || r >= maxR) break;
  }
  chosen.sort((a, b) => a.d - b.d || a.i - b.i);

  const slots: Vec2[] = [];
  for (let k = 0; k < chosen.length && k < count; k++) {
    const i = chosen[k]!.i;
    const tx = i % grid.width;
    const ty = (i - tx) / grid.width;
    slots.push(tx === c.tx && ty === c.ty ? { x: point.x, y: point.y } : tileCentre(tx, ty));
  }
  return slots;
}
