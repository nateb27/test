/** Path request queue (plan 4.3). Owned by WP2. */

import { findPath } from './astar';
import { gridOf, tileAt, tileCentre, type PathGrid } from './grid';
import { smoothPath } from './smooth';
import { findEntity } from '../entities';
import { PATH_BUDGET_PER_TICK, type PathGoal, type SimContext, type TilePos, type UnitEntity, type Vec2 } from '../types';

/**
 * Queue a path request for `unit`, replacing any outstanding one. Clears the
 * unit's current path; the unit stands still until the request is served.
 */
export function requestPath(ctx: SimContext, unit: UnitEntity, goal: PathGoal): void {
  const id = ctx.state.nextPathRequestId;
  ctx.state.nextPathRequestId = id + 1;
  ctx.state.pathQueue.push({
    id,
    unitId: unit.id,
    from: { tx: Math.floor(unit.pos.x), ty: Math.floor(unit.pos.y) },
    goal,
  });
  unit.pendingPathRequestId = id;
  unit.path = null;
}

export interface ComputedPath {
  /** Smoothed world-space waypoints, excluding the tile the search started on. */
  waypoints: Vec2[];
  /** The path ends at the goal (otherwise at the reachable tile nearest it). */
  reached: boolean;
  /** Search hit `maxExpansions` before finishing. */
  capped: boolean;
  /** Nodes expanded. */
  expanded: number;
}

/**
 * Pure: A* + smoothing from tile `from` to `goal`, as world waypoints.
 *
 * - Waypoints are tile centres of the smoothed path, without the start tile
 *   (the unit is already in it). If the search had to start from a different
 *   tile (blocked start), that tile's centre is kept as the first waypoint.
 * - For a reached `point` goal the last waypoint is the exact (clamped) point.
 * - A unit already at a reached `footprint` goal, or already on the nearest
 *   reachable tile of an unreachable goal, gets no waypoints.
 */
export function computePath(
  grid: PathGrid,
  from: TilePos,
  goal: PathGoal,
  maxExpansions: number = Number.MAX_SAFE_INTEGER,
): ComputedPath {
  const result = findPath(grid, from, goal, maxExpansions);
  const { tiles, reached, capped, expanded } = result;
  if (tiles.length === 0) return { waypoints: [], reached: false, capped, expanded };
  const w = grid.width;
  const start = tileAt(grid, from.tx, from.ty);
  const smoothed = smoothPath(grid, tiles);
  const first = smoothed[0]!;
  const startedElsewhere = first !== start.ty * w + start.tx;
  const waypoints: Vec2[] = [];
  for (let k = startedElsewhere ? 0 : 1; k < smoothed.length; k++) {
    const i = smoothed[k]!;
    const tx = i % w;
    waypoints.push(tileCentre(tx, (i - tx) / w));
  }
  if (reached && goal.kind === 'point') {
    const exact = {
      x: Math.min(w - 1 / 1024, Math.max(0, goal.x)),
      y: Math.min(grid.height - 1 / 1024, Math.max(0, goal.y)),
    };
    if (waypoints.length === 0) waypoints.push(exact);
    else waypoints[waypoints.length - 1] = exact;
  }
  return { waypoints, reached, capped, expanded };
}

/**
 * Tick step 5: serve queued requests in FIFO order within PATH_BUDGET_PER_TICK
 * node expansions. Stale requests (unit gone, or
 * `unit.pendingPathRequestId !== request.id`) are dropped at no cost.
 *
 * Each search is atomic: it runs with the remaining budget as its cap. If it
 * would exceed it, its result is discarded and the request stays at the head
 * of the queue, to be served first next tick with the full budget. The first
 * search of a tick that still hits the full budget (impossible on maps with
 * at most PATH_BUDGET_PER_TICK walkable tiles) uses its best partial path.
 * Expansions of a discarded search count toward the tick, so a tick never
 * expands more than PATH_BUDGET_PER_TICK nodes.
 *
 * Returns the number of nodes expanded this tick.
 */
export function processPathQueue(ctx: SimContext, budget: number = PATH_BUDGET_PER_TICK): number {
  const queue = ctx.state.pathQueue;
  if (queue.length === 0) return 0;
  const grid = gridOf(ctx);
  let used = 0;
  let served = 0;
  let consumed = 0;
  for (; consumed < queue.length; consumed++) {
    const req = queue[consumed]!;
    const unit = findEntity(ctx.state, req.unitId);
    if (unit === undefined || unit.kind !== 'unit' || unit.pendingPathRequestId !== req.id) continue;
    if (used >= budget) break;
    const result = computePath(grid, tileAt(grid, unit.pos.x, unit.pos.y), req.goal, budget - used);
    used += result.expanded;
    if (result.capped && served > 0) break;
    served++;
    unit.path = { waypoints: result.waypoints, nextIndex: 0, occupancyVersion: ctx.state.occupancyVersion };
    unit.pendingPathRequestId = null;
  }
  queue.splice(0, consumed);
  return used;
}
