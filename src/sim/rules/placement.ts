/** Placement rules (plan 4.5). Owned by WP7. */

import { availability } from './availability';
import type { BuildingId, PlacementResult, PlayerId, SimContext } from '../types';

/**
 * Whether the player may place `buildingType` with its footprint top-left at
 * (tx, ty): in bounds, every tile buildable and unoccupied, available, affordable.
 * STUB: never ok; footprint assumed 1x1.
 */
export function canPlace(
  ctx: SimContext,
  playerId: PlayerId,
  buildingType: BuildingId,
  _tx: number,
  _ty: number,
): PlacementResult {
  return {
    ok: false,
    size: 1,
    tiles: [null],
    availability: availability(ctx, playerId, buildingType),
  };
}
