/** Occupancy grid. Owned by WP1. */

import type { DataRegistry } from '../../data/schema';
import type { Entity, GameState, TilePos } from '../types';

/** Tile and footprint side of a building or node, or `null` for units and defs unknown to `data`. */
export function footprintOf(
  entity: Entity,
  data: DataRegistry,
): { tile: TilePos; size: number; blocking: boolean } | null {
  if (entity.kind === 'unit') return null;
  const def = data.def(entity.typeId);
  if (def === undefined || (def.kind !== 'building' && def.kind !== 'node')) return null;
  return { tile: entity.tile, size: def.footprint, blocking: def.blocking };
}

/** Set every in-bounds tile of a square footprint to `value` (1 blocked, 0 free). */
export function setFootprint(
  occupancy: Uint8Array,
  mapWidth: number,
  mapHeight: number,
  tile: TilePos,
  size: number,
  value: 0 | 1,
): void {
  for (let y = tile.ty; y < tile.ty + size; y++) {
    if (y < 0 || y >= mapHeight) continue;
    for (let x = tile.tx; x < tile.tx + size; x++) {
      if (x < 0 || x >= mapWidth) continue;
      occupancy[y * mapWidth + x] = value;
    }
  }
}

/**
 * Build the occupancy grid from state: one byte per tile, row-major,
 * non-zero where a blocking building (including foundations) or blocking node
 * stands. Entities whose def is unknown to `data` are ignored.
 */
export function buildOccupancy(state: GameState, data: DataRegistry): Uint8Array {
  const { width, height } = state.map;
  const grid = new Uint8Array(width * height);
  for (const entity of state.entities) {
    const fp = footprintOf(entity, data);
    if (fp !== null && fp.blocking) setFootprint(grid, width, height, fp.tile, fp.size, 1);
  }
  return grid;
}
