/** Spatial queries for `sim.query`. Owned by WP1. */

import { findEntity } from './entities';
import type { Entity, EntityId, SimContext } from './types';

export function entityById(ctx: SimContext, id: EntityId): Entity | undefined {
  return findEntity(ctx.state, id);
}

/** See `SimQuery.entitiesInRect`. STUB: always empty. */
export function entitiesInRect(
  _ctx: SimContext,
  _x0: number,
  _y0: number,
  _x1: number,
  _y1: number,
): Entity[] {
  return [];
}

/** See `SimQuery.entityAtPoint`. STUB: always undefined. */
export function entityAtPoint(_ctx: SimContext, _x: number, _y: number): Entity | undefined {
  return undefined;
}
