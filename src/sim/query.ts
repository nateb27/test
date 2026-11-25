/** Spatial queries for `sim.query`. Owned by WP1. */

import { findEntity } from './entities';
import { footprintOf } from './map/occupancy';
import { UNIT_PICK_RADIUS, type Entity, type EntityId, type SimContext } from './types';

export function entityById(ctx: SimContext, id: EntityId): Entity | undefined {
  return findEntity(ctx.state, id);
}

/** Footprint side of a building/node; 1 when its def is unknown. */
function sizeOf(ctx: SimContext, entity: Entity): number {
  return footprintOf(entity, ctx.data)?.size ?? 1;
}

/**
 * See `SimQuery.entitiesInRect`. Footprints are half-open `[tx, tx+size)` so a
 * zero-size rect at a point matches exactly the footprints containing it.
 */
export function entitiesInRect(ctx: SimContext, x0: number, y0: number, x1: number, y1: number): Entity[] {
  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1);
  const maxY = Math.max(y0, y1);
  const r2 = UNIT_PICK_RADIUS * UNIT_PICK_RADIUS;
  const out: Entity[] = [];
  for (const e of ctx.state.entities) {
    if (e.kind === 'unit') {
      const nx = Math.max(minX, Math.min(e.pos.x, maxX));
      const ny = Math.max(minY, Math.min(e.pos.y, maxY));
      const dx = e.pos.x - nx;
      const dy = e.pos.y - ny;
      if (dx * dx + dy * dy <= r2) out.push(e);
    } else {
      const size = sizeOf(ctx, e);
      if (e.tile.tx <= maxX && e.tile.tx + size > minX && e.tile.ty <= maxY && e.tile.ty + size > minY) {
        out.push(e);
      }
    }
  }
  return out;
}

/** See `SimQuery.entityAtPoint`: nearest unit in pick radius, else lowest-id building, else lowest-id node. */
export function entityAtPoint(ctx: SimContext, x: number, y: number): Entity | undefined {
  const r2 = UNIT_PICK_RADIUS * UNIT_PICK_RADIUS;
  let bestUnit: Entity | undefined;
  let bestD2 = 0;
  let building: Entity | undefined;
  let node: Entity | undefined;
  for (const e of ctx.state.entities) {
    if (e.kind === 'unit') {
      const dx = e.pos.x - x;
      const dy = e.pos.y - y;
      const d2 = dx * dx + dy * dy;
      // Ascending id iteration: strict `<` keeps the lowest id on ties.
      if (d2 <= r2 && (bestUnit === undefined || d2 < bestD2)) {
        bestUnit = e;
        bestD2 = d2;
      }
      continue;
    }
    if (e.kind === 'building' ? building !== undefined : node !== undefined) continue;
    const size = sizeOf(ctx, e);
    if (x >= e.tile.tx && x < e.tile.tx + size && y >= e.tile.ty && y < e.tile.ty + size) {
      if (e.kind === 'building') building = e;
      else node = e;
    }
  }
  return bestUnit ?? building ?? node;
}
