/**
 * Spatial index (PLAN-M2 2.3): a uniform grid in `SimRuntime.spatial`, rebuilt from scratch at the start of tick
 * step 4. Never saved or hashed. Owned by WP21 (Combat core).
 *
 * Contract for the query functions: they visit candidates in ring order outward from the query cell (ring 0, then
 * ring 1 in row-major order, ...), count one *check* per candidate looked at, stop at `budget` checks or when `visit`
 * returns `true`, and return the number of checks used. Consumers choose by a total order (tier, d², id) or apply an
 * order-independent effect, so the visiting order never changes a result unless the budget cuts the scan short.
 *
 * Details (WP21):
 * - A unit is filed under the cell containing its position (clamped to the grid). Units are inserted in descending
 *   array order, so every cell's list runs in ascending id.
 * - A building is listed in every cell its footprint `[tx, tx+size) x [ty, ty+size)` overlaps, ascending id.
 * - Cells whose rectangle lies farther than `r` from the query point are skipped without spending checks.
 * - A building that overlaps several visited cells is looked at (and charged) once per query, in the first of them.
 * - Positions read are those at rebuild time for the cell assignment; the distance test uses current positions.
 *   Callers after movement (steps 8-9) pad `r` by `SPATIAL_QUERY_PAD`.
 */

import { findEntity } from '../../entities';
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

function cellCoord(v: number, cellSize: number, count: number): number {
  return Math.min(count - 1, Math.max(0, Math.floor(v / cellSize)));
}

/** Rebuild `ctx.runtime.spatial` from the current entities (start of tick step 4). */
export function rebuildSpatialIndex(ctx: SimContext): void {
  const index = ctx.runtime.spatial;
  const { cellSize, cols, rows } = index;
  const units: UnitEntity[] = [];
  for (const cell of index.buildingCells) cell.length = 0;
  for (const e of ctx.state.entities) {
    if (e.kind === 'unit') {
      units.push(e);
    } else if (e.kind === 'building') {
      const size = ctx.data.building(e.typeId).footprint;
      const cx0 = cellCoord(e.tile.tx, cellSize, cols);
      const cy0 = cellCoord(e.tile.ty, cellSize, rows);
      const cx1 = cellCoord(e.tile.tx + size - 1, cellSize, cols);
      const cy1 = cellCoord(e.tile.ty + size - 1, cellSize, rows);
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) index.buildingCells[cy * cols + cx]!.push(e.id);
      }
    }
  }
  index.unitHead.fill(-1);
  if (index.unitNext.length < units.length) index.unitNext = new Int32Array(Math.max(units.length, index.unitNext.length * 2));
  for (let i = units.length - 1; i >= 0; i--) {
    const u = units[i]!;
    const c = cellCoord(u.pos.y, cellSize, rows) * cols + cellCoord(u.pos.x, cellSize, cols);
    index.unitNext[i] = index.unitHead[c]!;
    index.unitHead[c] = i;
  }
  index.units = units;
}

/** Squared distance from (x, y) to the rectangle of cell (cx, cy). */
function cellDistSq(index: SpatialIndex, cx: number, cy: number, x: number, y: number): number {
  const s = index.cellSize;
  const nx = Math.min(Math.max(x, cx * s), (cx + 1) * s);
  const ny = Math.min(Math.max(y, cy * s), (cy + 1) * s);
  return (nx - x) * (nx - x) + (ny - y) * (ny - y);
}

/**
 * Call `cell(c)` for every grid cell within `r` of (x, y), in ring order (ring 0 = the query cell, then ring k in
 * row-major order). `cell` returns true to stop.
 */
function forEachCellInRings(index: SpatialIndex, x: number, y: number, r: number, cell: (c: number) => boolean): void {
  const { cellSize, cols, rows } = index;
  const qx = cellCoord(x, cellSize, cols);
  const qy = cellCoord(y, cellSize, rows);
  const x0 = cellCoord(x - r, cellSize, cols);
  const x1 = cellCoord(x + r, cellSize, cols);
  const y0 = cellCoord(y - r, cellSize, rows);
  const y1 = cellCoord(y + r, cellSize, rows);
  const maxRing = Math.max(qx - x0, x1 - qx, qy - y0, y1 - qy);
  const r2 = r * r;
  for (let k = 0; k <= maxRing; k++) {
    for (let cy = qy - k; cy <= qy + k; cy++) {
      if (cy < y0 || cy > y1) continue;
      const edgeRow = cy === qy - k || cy === qy + k;
      for (let cx = qx - k; cx <= qx + k; cx += edgeRow || k === 0 ? 1 : 2 * k) {
        if (cx < x0 || cx > x1) continue;
        if (cellDistSq(index, cx, cy, x, y) > r2) continue;
        if (cell(cy * cols + cx)) return;
      }
    }
  }
}

/** Visit units whose centre is within `r` of (x, y). Returns checks used. */
export function visitUnitsNear(
  ctx: SimContext,
  x: number,
  y: number,
  r: number,
  budget: number,
  visit: (unit: UnitEntity) => boolean,
): number {
  const index = ctx.runtime.spatial;
  const r2 = r * r;
  let checks = 0;
  if (budget <= 0 || !(r >= 0)) return 0;
  forEachCellInRings(index, x, y, r, (c) => {
    for (let i = index.unitHead[c]!; i !== -1; i = index.unitNext[i]!) {
      if (checks >= budget) return true;
      checks += 1;
      const u = index.units[i]!;
      const dx = u.pos.x - x;
      const dy = u.pos.y - y;
      if (dx * dx + dy * dy <= r2 && visit(u)) return true;
    }
    return checks >= budget;
  });
  return checks;
}

/** Query stamps for de-duplicating buildings listed in several cells (scratch, not state). */
const buildingStamp = new Map<number, number>();
let queryStamp = 0;

/** Visit buildings whose footprint comes within `r` of (x, y). Returns checks used. */
export function visitBuildingsNear(
  ctx: SimContext,
  x: number,
  y: number,
  r: number,
  budget: number,
  visit: (building: BuildingEntity) => boolean,
): number {
  const index = ctx.runtime.spatial;
  const r2 = r * r;
  let checks = 0;
  if (budget <= 0 || !(r >= 0)) return 0;
  queryStamp += 1;
  if (queryStamp > 1_000_000_000) {
    queryStamp = 1;
    buildingStamp.clear();
  }
  const stamp = queryStamp;
  forEachCellInRings(index, x, y, r, (c) => {
    for (const id of index.buildingCells[c]!) {
      if (buildingStamp.get(id) === stamp) continue;
      if (checks >= budget) return true;
      buildingStamp.set(id, stamp);
      checks += 1;
      const e = findEntity(ctx.state, id);
      if (e === undefined || e.kind !== 'building') continue;
      const size = ctx.data.building(e.typeId).footprint;
      const nx = Math.min(Math.max(x, e.tile.tx), e.tile.tx + size);
      const ny = Math.min(Math.max(y, e.tile.ty), e.tile.ty + size);
      const dx = nx - x;
      const dy = ny - y;
      if (dx * dx + dy * dy <= r2 && visit(e)) return true;
    }
    return checks >= budget;
  });
  return checks;
}
