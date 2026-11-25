/** Path request queue (plan 4.3). Owned by WP2. */

import type { PathGoal, SimContext, UnitEntity } from '../types';

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

/**
 * Tick step 5: serve queued requests in FIFO order within PATH_BUDGET_PER_TICK
 * node expansions. Each request is served atomically. Stale requests (unit
 * gone, or `unit.pendingPathRequestId !== request.id`) are dropped.
 * STUB: leaves the queue untouched.
 */
export function processPathQueue(_ctx: SimContext): void {
  // Implemented by WP2.
}
