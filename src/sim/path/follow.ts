/**
 * Path following for walking orders (plan 4.3). Owned by WP2.
 *
 * Every order that walks somewhere (move, gather, build, drop off, rally)
 * calls `followPath` once per tick from its `run` while walking, with the
 * same goal each time. It requests the path, waits for it, detects stale
 * paths and re-requests, and reports arrival. Movement (tick step 6) does
 * the actual stepping. When the goal changes, call `requestPath` directly
 * (or set `unit.path = null`) so the old path is not reused.
 */

import { gridOf, tileAt, type PathGrid } from './grid';
import { requestPath } from './queue';
import { lineWalkable } from './smooth';
import type { PathGoal, SimContext, UnitEntity, UnitPath, Vec2 } from '../types';

export type FollowStatus =
  /** A path request is outstanding; the unit stands still. */
  | 'waiting'
  /** The unit has a valid path and movement will advance it this tick. */
  | 'moving'
  /**
   * The path is used up: the unit is at the goal, or (for an unreachable
   * goal) at the reachable tile nearest to it. Callers that need to be at
   * the goal check the position themselves.
   */
  | 'arrived';

/**
 * Is the straight walk from `pos` to `target` still clear? Uses the same
 * tile walk as smoothing. A unit standing on a now-blocked tile (e.g. a
 * foundation placed on it) may walk out, so its own tile is not required to
 * be walkable.
 */
export function segmentWalkable(grid: PathGrid, pos: Vec2, target: Vec2): boolean {
  const a = tileAt(grid, pos.x, pos.y);
  const b = tileAt(grid, target.x, target.y);
  if (grid.blocked[a.ty * grid.width + a.tx] !== 0) {
    return a.tx === b.tx && a.ty === b.ty ? false : grid.blocked[b.ty * grid.width + b.tx] === 0;
  }
  return lineWalkable(grid, a.tx, a.ty, b.tx, b.ty);
}

/** Every remaining segment of `path`, starting at `pos`, is still clear. */
export function remainingPathWalkable(grid: PathGrid, pos: Vec2, path: UnitPath): boolean {
  let from = pos;
  for (let k = path.nextIndex; k < path.waypoints.length; k++) {
    const wp = path.waypoints[k]!;
    if (!segmentWalkable(grid, from, wp)) return false;
    from = wp;
  }
  return true;
}

/** See the module comment. */
export function followPath(ctx: SimContext, unit: UnitEntity, goal: PathGoal): FollowStatus {
  if (unit.pendingPathRequestId !== null) return 'waiting';
  const path = unit.path;
  if (path === null) {
    requestPath(ctx, unit, goal);
    return 'waiting';
  }
  if (path.nextIndex >= path.waypoints.length) return 'arrived';
  if (path.occupancyVersion !== ctx.state.occupancyVersion) {
    if (!remainingPathWalkable(gridOf(ctx), unit.pos, path)) {
      requestPath(ctx, unit, goal);
      return 'waiting';
    }
    path.occupancyVersion = ctx.state.occupancyVersion;
  }
  return 'moving';
}
