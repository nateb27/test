/** Placement rules (plan 4.5). Owned by WP7. */

import { availability } from './availability';
import type { BuildingDef } from '../../data/schema';
import { footprintOf } from '../map/occupancy';
import type {
  Availability,
  BuildingId,
  PlacementResult,
  PlacementTileProblem,
  PlayerId,
  SimContext,
} from '../types';

/** Number of buildings of `typeId` the player owns, unfinished foundations included. */
export function countOwnedBuildings(ctx: SimContext, playerId: PlayerId, typeId: BuildingId): number {
  let n = 0;
  for (const e of ctx.state.entities) {
    if (e.kind === 'building' && e.owner === playerId && e.typeId === typeId) n++;
  }
  return n;
}

/**
 * Availability with the build limit enforced here too (the limit counts
 * unfinished foundations): if the limit is reached and the base availability
 * did not already say so, a `buildLimit` reason is added.
 */
function placementAvailability(ctx: SimContext, playerId: PlayerId, def: BuildingDef): Availability {
  const base = availability(ctx, playerId, def.id);
  const limit = def.buildLimit;
  if (limit === undefined || countOwnedBuildings(ctx, playerId, def.id) < limit) return base;
  if (base.reasons.some((r) => r.code === 'buildLimit')) return base;
  return { ...base, available: false, reasons: [...base.reasons, { code: 'buildLimit', limit }] };
}

/**
 * Whether the player may place `buildingType` with its footprint top-left at
 * (tx, ty): in bounds, every tile buildable and unoccupied (blocked by a
 * building or node, or covered by a non-blocking building such as a farm),
 * available (including the build limit) and affordable.
 *
 * Reason codes: per tile in `tiles` (`outOfBounds`, `notBuildable`,
 * `occupied`), the availability reasons in `availability.reasons`
 * (`buildLimit`, `requiresAge`, ...) and `availability.affordable` /
 * `shortfall`. `ok` is true only when none of them applies. Units standing on
 * the footprint do not block placement; they are displaced. A def that is not
 * a placeable building (unknown, or `buildable: false`) is never ok.
 */
export function canPlace(
  ctx: SimContext,
  playerId: PlayerId,
  buildingType: BuildingId,
  tx: number,
  ty: number,
): PlacementResult {
  const def = ctx.data.def(buildingType);
  if (def === undefined || def.kind !== 'building') {
    return {
      ok: false,
      size: 1,
      tiles: ['notBuildable'],
      availability: availability(ctx, playerId, buildingType),
    };
  }
  const size = def.footprint;
  const x0 = Math.floor(tx);
  const y0 = Math.floor(ty);
  const { width, height } = ctx.state.map;
  // Tiles covered by non-blocking buildings/nodes (farms); they are not in the occupancy grid.
  const covered = new Set<number>();
  for (const e of ctx.state.entities) {
    if (e.kind === 'unit') continue;
    const fp = footprintOf(e, ctx.data);
    if (fp === null || fp.blocking) continue;
    for (let y = Math.max(y0, fp.tile.ty); y < Math.min(y0 + size, fp.tile.ty + fp.size); y++) {
      for (let x = Math.max(x0, fp.tile.tx); x < Math.min(x0 + size, fp.tile.tx + fp.size); x++) {
        covered.add(y * width + x);
      }
    }
  }
  const tiles: (PlacementTileProblem | null)[] = [];
  for (let y = y0; y < y0 + size; y++) {
    for (let x = x0; x < x0 + size; x++) {
      if (x < 0 || y < 0 || x >= width || y >= height) {
        tiles.push('outOfBounds');
        continue;
      }
      const i = y * width + x;
      const terrain = ctx.data.terrains.find((t) => t.id === ctx.state.map.tiles[i]);
      if (terrain !== undefined && !terrain.buildable) tiles.push('notBuildable');
      else if (ctx.runtime.occupancy[i] !== 0 || covered.has(i)) tiles.push('occupied');
      else tiles.push(null);
    }
  }
  const avail = placementAvailability(ctx, playerId, def);
  const ok = def.buildable && tiles.every((t) => t === null) && avail.available && avail.affordable;
  return { ok, size, tiles, availability: avail };
}
