/**
 * Picking helpers: sprite-bounds hit testing with units over buildings over
 * nodes (plan 6). Pure functions over the entities drawn on the last frame.
 */

import type { EntityId } from '../../sim/types';
import { KIND_PRIORITY, type DrawnEntity } from './entities';

/** Entity under a point given in world pixels (iso screen space at 1x), or null. */
export function pickDrawn(drawn: readonly DrawnEntity[], px: number, py: number): EntityId | null {
  let best: DrawnEntity | null = null;
  // `drawn` is back to front, so walk it in reverse: first hit per kind is the front-most.
  for (let i = drawn.length - 1; i >= 0; i--) {
    const d = drawn[i]!;
    if (px < d.hit.minX || px > d.hit.maxX || py < d.hit.minY || py > d.hit.maxY) continue;
    if (best === null || KIND_PRIORITY[d.kind] < KIND_PRIORITY[best.kind]) best = d;
    if (best.kind === 'unit') break;
  }
  return best === null ? null : best.id;
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
