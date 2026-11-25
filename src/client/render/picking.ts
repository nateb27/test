/**
 * Picking helpers: sprite-bounds hit testing with units over buildings over
 * nodes (plan 6). Pure functions over the entities drawn on the last frame.
 */

import type { EntityId } from '../../sim/types';
import type { DrawnEntity } from './entities';
import { screenToWorld } from './iso';

/**
 * Entity under a point given in world pixels (iso screen space at 1x), or null.
 *
 * Order: units (sprite body box) first; then footprint-first for buildings and
 * nodes (the point lies on the entity's ground footprint, so a click on open
 * ground next to a tree is not the tree); then the sprite body that overhangs
 * a footprint (a click on a tree's canopy or a roof). Within a tier buildings
 * win over nodes, then the front-most (`drawn` is back to front).
 */
export function pickDrawn(drawn: readonly DrawnEntity[], px: number, py: number): EntityId | null {
  let building: DrawnEntity | null = null;
  let node: DrawnEntity | null = null;
  let bodyBuilding: DrawnEntity | null = null;
  let bodyNode: DrawnEntity | null = null;
  const w = screenToWorld(px, py);
  for (let i = drawn.length - 1; i >= 0; i--) {
    const d = drawn[i]!;
    if (d.kind === 'unit') {
      if (px >= d.hit.minX && px <= d.hit.maxX && py >= d.hit.minY && py <= d.hit.maxY) return d.id;
      continue;
    }
    const half = d.size / 2;
    if (d.size > 0 && w.x >= d.wx - half && w.x < d.wx + half && w.y >= d.wy - half && w.y < d.wy + half) {
      if (d.kind === 'building') building ??= d;
      else node ??= d;
    } else if (px >= d.hit.minX && px <= d.hit.maxX && py >= d.hit.minY && py <= d.hit.maxY) {
      if (d.kind === 'building') bodyBuilding ??= d;
      else bodyNode ??= d;
    }
  }
  return (building ?? node ?? bodyBuilding ?? bodyNode)?.id ?? null;
}

export interface PickRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Entities whose screen anchor lies inside a rectangle in world pixels
 * (box select). `kinds` restricts the result; default is units only.
 */
export function pickRect(
  drawn: readonly DrawnEntity[],
  rect: PickRect,
  anchorToPx: (wx: number, wy: number) => { x: number; y: number },
  kinds: readonly DrawnEntity['kind'][] = ['unit'],
): EntityId[] {
  const out: EntityId[] = [];
  for (const d of drawn) {
    if (!kinds.includes(d.kind)) continue;
    const p = anchorToPx(d.wx, d.wy);
    // Use the middle of the body for units (a little above the feet).
    const py = d.kind === 'unit' ? p.y - 12 : p.y;
    if (p.x >= rect.minX && p.x <= rect.maxX && py >= rect.minY && py <= rect.maxY) out.push(d.id);
  }
  return out;
}
