/** Tick step 6: movement integration and idle separation (plan 4.3). Owned by WP2. */

import { segmentWalkable } from '../path/follow';
import { gridOf, isWalkable, type PathGrid } from '../path/grid';
import { COMBAT_SEPARATION_RADIUS, SEPARATION_RADIUS, TICK_RATE, type Facing, type SimContext, type UnitEntity } from '../types';

/** Speed (tiles per second) used when neither the stat cache nor the data know the unit type. */
export const FALLBACK_UNIT_SPEED = 1;

/**
 * A unit's speed in tiles per second: the resolved stat cache if present,
 * else the base def, else FALLBACK_UNIT_SPEED. Never throws.
 */
export function unitSpeed(ctx: SimContext, unit: UnitEntity): number {
  const cached = ctx.runtime.resolvedStats[unit.owner]?.[unit.typeId]?.speed;
  if (cached !== undefined && Number.isFinite(cached) && cached > 0) return cached;
  const def = ctx.data.def(unit.typeId);
  if (def !== undefined && def.kind === 'unit' && Number.isFinite(def.speed) && def.speed > 0) return def.speed;
  return FALLBACK_UNIT_SPEED;
}

/**
 * Facing from a movement delta, by comparing signs and magnitudes only. A
 * component counts if it is at least 0.4 times the other (~22 degrees, the
 * octant boundary is at tan(22.5) ~ 0.414). Returns `null` for no movement.
 */
export function facingFromDelta(dx: number, dy: number): Facing | null {
  if (dx === 0 && dy === 0) return null;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const xMatters = ax * 5 > ay * 2;
  const yMatters = ay * 5 > ax * 2;
  if (xMatters && !yMatters) return dx > 0 ? 0 : 4;
  if (yMatters && !xMatters) return dy > 0 ? 2 : 6;
  if (dx > 0) return dy > 0 ? 1 : 7;
  return dy > 0 ? 3 : 5;
}

/** A unit with nothing to do: no order, nothing queued, no path, no pending request. */
export function isIdle(unit: UnitEntity): boolean {
  return (
    unit.currentOrder === null &&
    unit.orderQueue.length === 0 &&
    unit.path === null &&
    unit.pendingPathRequestId === null
  );
}

/**
 * A stationary engaged unit (PLAN-M2 4.7): standing and attacking (phase `attacking`/`engaging`, or a hold with a
 * target), no path and no pending request. These join the separation pass at COMBAT_SEPARATION_RADIUS.
 */
export function isStationaryAttacker(unit: UnitEntity): boolean {
  if (unit.path !== null || unit.pendingPathRequestId !== null) return false;
  const o = unit.currentOrder;
  if (o === null) return false;
  switch (o.type) {
    case 'attack':
      return o.phase === 'attacking';
    case 'attackMove':
      return o.phase === 'engaging';
    case 'hold':
      return o.targetId !== null;
    default:
      return false;
  }
}

/** Remove -0 (positions must never store it). */
function noNegZero(v: number): number {
  return v === 0 ? 0 : v;
}

function moveAlongPath(ctx: SimContext, grid: PathGrid, unit: UnitEntity): void {
  const path = unit.path;
  if (path === null || unit.pendingPathRequestId !== null) return;
  if (path.nextIndex >= path.waypoints.length) {
    // A used-up path with no order holding it is dropped so the unit counts as idle.
    if (unit.currentOrder === null) unit.path = null;
    return;
  }
  // Stale check (orders normally do this via followPath; this catches the rest).
  if (path.occupancyVersion !== ctx.state.occupancyVersion) {
    const wp = path.waypoints[path.nextIndex]!;
    if (!segmentWalkable(grid, unit.pos, wp)) {
      unit.path = null;
      return;
    }
  }
  let remaining = unitSpeed(ctx, unit) / TICK_RATE;
  while (remaining > 0 && path.nextIndex < path.waypoints.length) {
    const wp = path.waypoints[path.nextIndex]!;
    const dx = wp.x - unit.pos.x;
    const dy = wp.y - unit.pos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= remaining) {
      unit.pos.x = wp.x;
      unit.pos.y = wp.y;
      remaining -= dist;
      path.nextIndex++;
    } else {
      const f = remaining / dist;
      unit.pos.x = noNegZero(unit.pos.x + dx * f);
      unit.pos.y = noNegZero(unit.pos.y + dy * f);
      remaining = 0;
    }
  }
  const facing = facingFromDelta(unit.pos.x - unit.prevPos.x, unit.pos.y - unit.prevPos.y);
  if (facing !== null) unit.facing = facing;
}

// Spatial hash scratch (not state): one bucket per tile, singly linked.
let bucketHead = new Int32Array(0);
let bucketNext = new Int32Array(0);
let pushX = new Float64Array(0);
let pushY = new Float64Array(0);
let engaged = new Uint8Array(0);

/** Unit vectors used to split exactly coincident units, picked by the higher id. */
const SPLIT_X: readonly number[] = [1, Math.SQRT1_2, 0, -Math.SQRT1_2, -1, -Math.SQRT1_2, 0, Math.SQRT1_2];
const SPLIT_Y: readonly number[] = [0, Math.SQRT1_2, 1, Math.SQRT1_2, 0, -Math.SQRT1_2, -1, -Math.SQRT1_2];

/**
 * Push apart idle units closer than SEPARATION_RADIUS, and stationary attackers (see `isStationaryAttacker`)
 * closer than COMBAT_SEPARATION_RADIUS from each other and from idle units. Each close pair moves
 * apart by half the overlap each, along the line between them (coincident
 * units split along a direction chosen by the higher id). All pushes are
 * summed first and then applied, so the result does not depend on pair
 * order. A push that would end on a blocked tile is not applied.
 */
export function separateIdleUnits(ctx: SimContext, grid: PathGrid): void {
  const idle: UnitEntity[] = [];
  for (const e of ctx.state.entities) {
    if (e.kind === 'unit' && (isIdle(e) || isStationaryAttacker(e))) idle.push(e);
  }
  const n = idle.length;
  if (n < 2) return;
  const cells = grid.width * grid.height;
  if (bucketHead.length < cells) bucketHead = new Int32Array(cells);
  if (bucketNext.length < n) {
    bucketNext = new Int32Array(n);
    pushX = new Float64Array(n);
    pushY = new Float64Array(n);
    engaged = new Uint8Array(n);
  }
  bucketHead.fill(-1, 0, cells);
  pushX.fill(0, 0, n);
  pushY.fill(0, 0, n);
  for (let i = 0; i < n; i++) engaged[i] = isIdle(idle[i]!) ? 0 : 1;
  const cellOf = (u: UnitEntity): number => {
    const tx = Math.min(grid.width - 1, Math.max(0, Math.floor(u.pos.x)));
    const ty = Math.min(grid.height - 1, Math.max(0, Math.floor(u.pos.y)));
    return ty * grid.width + tx;
  };
  // Insert in descending index so each bucket lists units in ascending id.
  for (let i = n - 1; i >= 0; i--) {
    const c = cellOf(idle[i]!);
    bucketNext[i] = bucketHead[c]!;
    bucketHead[c] = i;
  }
  for (let i = 0; i < n; i++) {
    const a = idle[i]!;
    const ax = Math.min(grid.width - 1, Math.max(0, Math.floor(a.pos.x)));
    const ay = Math.min(grid.height - 1, Math.max(0, Math.floor(a.pos.y)));
    for (let cy = ay - 1; cy <= ay + 1; cy++) {
      if (cy < 0 || cy >= grid.height) continue;
      for (let cx = ax - 1; cx <= ax + 1; cx++) {
        if (cx < 0 || cx >= grid.width) continue;
        for (let j = bucketHead[cy * grid.width + cx]!; j !== -1; j = bucketNext[j]!) {
          if (j <= i) continue; // each pair once, lower index (id) first
          const b = idle[j]!;
          let dx = b.pos.x - a.pos.x;
          let dy = b.pos.y - a.pos.y;
          const d2 = dx * dx + dy * dy;
          const r = engaged[i] === 1 || engaged[j] === 1 ? COMBAT_SEPARATION_RADIUS : SEPARATION_RADIUS;
          if (d2 >= r * r) continue;
          let d = Math.sqrt(d2);
          if (d === 0) {
            const k = b.id % 8;
            dx = SPLIT_X[k]!;
            dy = SPLIT_Y[k]!;
            d = 1;
          }
          const push = (r - Math.sqrt(d2)) / 2 / d;
          pushX[i] = pushX[i]! - dx * push;
          pushY[i] = pushY[i]! - dy * push;
          pushX[j] = pushX[j]! + dx * push;
          pushY[j] = pushY[j]! + dy * push;
        }
      }
    }
  }
  const maxX = grid.width - 1 / 1024;
  const maxY = grid.height - 1 / 1024;
  for (let i = 0; i < n; i++) {
    const px = pushX[i]!;
    const py = pushY[i]!;
    if (px === 0 && py === 0) continue;
    const u = idle[i]!;
    const nx = noNegZero(Math.min(maxX, Math.max(0, u.pos.x + px)));
    const ny = noNegZero(Math.min(maxY, Math.max(0, u.pos.y + py)));
    if (!isWalkable(grid, Math.floor(nx), Math.floor(ny))) continue;
    u.pos.x = nx;
    u.pos.y = ny;
  }
}

/**
 * First set `prevPos = pos` for EVERY unit (so the renderer can interpolate),
 * then move units along their paths at their resolved speed / TICK_RATE
 * (possibly past several waypoints in one tick), update facing from the
 * tick's movement, then push apart idle units and stationary attackers (see `separateIdleUnits`).
 * Units with a pending path request stand still.
 */
export function runMovement(ctx: SimContext): void {
  for (const entity of ctx.state.entities) {
    if (entity.kind !== 'unit') continue;
    entity.prevPos.x = entity.pos.x;
    entity.prevPos.y = entity.pos.y;
  }
  const grid = gridOf(ctx);
  for (const entity of ctx.state.entities) {
    if (entity.kind !== 'unit') continue;
    moveAlongPath(ctx, grid, entity);
  }
  separateIdleUnits(ctx, grid);
}
