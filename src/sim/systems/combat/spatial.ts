/**
 * Spatial index (PLAN-M2 2.3): a uniform grid in `SimRuntime.spatial`, rebuilt from scratch at the start of tick
 * step 4. Never saved or hashed. Owned by WP21 (Combat core).
 *
 * Contract for the query functions: they visit candidates in ring order outward from the query cell (ring 0, then
 * ring 1 in row-major order, ...), count one *check* per candidate looked at, stop at `budget` checks or when `visit`
 * returns `true`, and return the number of checks used. Consumers choose by a total order (tier, d², id) or apply an
 * order-independent effect, so the visiting order never changes a result unless the budget cuts the scan short.
 */

import { SPATIAL_CELL_SIZE, type BuildingEntity, type SimContext, type SpatialIndex, type UnitEntity } from '../../types';

/** An empty index for a map of the given size (all heads -1, no units, no buildings). */
export function createSpatialIndex(width: number, height: number): SpatialIndex {
  const cellSize = SPATIAL_CELL_SIZE;
  const cols = Math.max(1, Math.ceil(width / cellSize));
  const rows = Math.max(1, Math.ceil(height / cellSize));
  const buildingCells: number[][] = [];
  for (let i = 0; i < cols * rows; i++) buildingCells.push([]);
  return {
    cellSize,
    cols,
    rows,
    unitHead: new Int32Array(cols * rows).fill(-1),
    unitNext: new Int32Array(0),
    units: [],
    buildingCells,
  };
}

/**
 * Rebuild `ctx.runtime.spatial` from the current entities (start of tick step 4).
 *
 * STUB (TODO(WP21)): does nothing yet; the query stubs below scan `state.entities` directly.
 */
export function rebuildSpatialIndex(_ctx: SimContext): void {
  // STUB: replaced by WP21.
}

/**
 * Visit units whose centre is within `r` of (x, y). Returns checks used.
 *
 * STUB (TODO(WP21)): a linear scan in ascending id (one check per unit looked at) so callers written against the
 * contract work before the grid lands. Same signature and stopping rules as the real one.
 */
export function visitUnitsNear(
  ctx: SimContext,
  x: number,
  y: number,
  r: number,
  budget: number,
  visit: (unit: UnitEntity) => boolean,
): number {
  let checks = 0;
  const r2 = r * r;
  for (const e of ctx.state.entities) {
    if (e.kind !== 'unit') continue;
    if (checks >= budget) break;
    checks += 1;
    const dx = e.pos.x - x;
    const dy = e.pos.y - y;
    if (dx * dx + dy * dy <= r2 && visit(e)) break;
  }
  return checks;
}

/**
 * Visit buildings whose footprint comes within `r` of (x, y). Returns checks used.
 *
 * STUB (TODO(WP21)): a linear scan in ascending id, like `visitUnitsNear`.
 */
export function visitBuildingsNear(
  ctx: SimContext,
  x: number,
  y: number,
  r: number,
  budget: number,
  visit: (building: BuildingEntity) => boolean,
): number {
  let checks = 0;
  const r2 = r * r;
  for (const e of ctx.state.entities) {
    if (e.kind !== 'building') continue;
    if (checks >= budget) break;
    checks += 1;
    const size = ctx.data.building(e.typeId).footprint;
    const nx = Math.min(Math.max(x, e.tile.tx), e.tile.tx + size);
    const ny = Math.min(Math.max(y, e.tile.ty), e.tile.ty + size);
    const dx = nx - x;
    const dy = ny - y;
    if (dx * dx + dy * dy <= r2 && visit(e)) break;
  }
  return checks;
}
