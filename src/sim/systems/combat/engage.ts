/**
 * Engagement helpers shared by the `attack`, `attackMove` and `hold` orders, acquisition and unit attacks
 * (PLAN-M2 4.2, 4.6). Owned by WP21 (Combat core).
 */

import { findEntity } from '../../entities';
import { directPath, followPath } from '../../path/follow';
import { requestPath } from '../../path/queue';
import {
  CHASE_DIRECT_DISTANCE,
  CHASE_REPATH_DISTANCE,
  CHASE_REPATH_TICKS,
  type BuildingEntity,
  type Entity,
  type EntityId,
  type ResolvedUnitCombat,
  type SimContext,
  type UnitEntity,
  type Vec2,
} from '../../types';
import { buildingCombat, computeDamage, distSqToTarget, isEnemy, unitCombat } from './damage';

/** A unit or building that can be attacked. */
export type Attackable = UnitEntity | BuildingEntity;

/**
 * Can `unit` (with resolved profile `profile`) target `target` (PLAN-M2 4.2)? Never itself, allies, neutral
 * entities, resource nodes or entities with hp 0; `targets: 'buildings'` units only buildings.
 */
export function canTarget(unit: UnitEntity, profile: ResolvedUnitCombat, target: Entity | undefined): target is Attackable {
  if (target === undefined || target.id === unit.id) return false;
  if (target.kind === 'node') return false;
  if (!isEnemy(unit.owner, target.owner) || target.hp <= 0) return false;
  return profile.targets === 'any' || target.kind === 'building';
}

/** The entity with this id if `unit` can target it, else undefined. */
export function targetFor(ctx: SimContext, unit: UnitEntity, profile: ResolvedUnitCombat, id: EntityId | null): Attackable | undefined {
  if (id === null) return undefined;
  const e = findEntity(ctx.state, id);
  return canTarget(unit, profile, e) ? e : undefined;
}

/** Squared-distance reach test of 4.2: `d² <= reach²` and, with a minimum range, `d² >= minRange²`. */
export function inReachSq(profile: ResolvedUnitCombat, d2: number): boolean {
  if (d2 > profile.reach * profile.reach) return false;
  return profile.minRange <= 0 || d2 >= profile.minRange * profile.minRange;
}

/** Is `target` in reach of `unit` at its current position? */
export function inReach(ctx: SimContext, unit: UnitEntity, profile: ResolvedUnitCombat, target: Entity): boolean {
  return inReachSq(profile, distSqToTarget(ctx, unit.pos.x, unit.pos.y, target));
}

/** Anchor of a target: unit position, or building footprint centre. */
export function targetAnchor(ctx: SimContext, target: Attackable): Vec2 {
  if (target.kind === 'unit') return { x: target.pos.x, y: target.pos.y };
  const size = ctx.data.building(target.typeId).footprint;
  return { x: target.tile.tx + size / 2, y: target.tile.ty + size / 2 };
}

/** Damage `attacker` (resolved profile) deals to `target` under 4.1. */
export function damageAgainst(ctx: SimContext, profile: ResolvedUnitCombat, target: Attackable): number {
  const def = target.kind === 'unit' ? unitCombat(ctx, target.owner, target.typeId) : buildingCombat(ctx, target.owner, target.typeId);
  return computeDamage(profile, def, ctx.data.combat.minDamage);
}

/**
 * Acquisition tier of a candidate (4.5), without the tier-0 retaliation rule: 1 = fighting enemy unit
 * (`autoAcquire` and `targets: 'any'`), 2 = other enemy unit, 3 = building.
 */
export function baseTier(ctx: SimContext, target: Attackable): 1 | 2 | 3 {
  if (target.kind === 'building') return 3;
  const p = unitCombat(ctx, target.owner, target.typeId);
  return p.autoAcquire && p.targets === 'any' ? 1 : 2;
}

/** Stop where the unit stands: drop the path and any outstanding request. */
export function standStill(unit: UnitEntity): void {
  unit.path = null;
  unit.pendingPathRequestId = null;
}

/** The chase bookkeeping an engagement order carries. */
export interface ChaseState {
  repathTick: number;
}

/**
 * Last waypoint of the unit's current path (the goal of a reached point path), or the unit's position for an
 * empty path.
 */
function pathGoal(unit: UnitEntity): Vec2 | null {
  const path = unit.path;
  if (path === null) return null;
  const last = path.waypoints[path.waypoints.length - 1];
  return last ?? unit.pos;
}

/** Request an A* path if the throttle allows (`tick >= repathTick`); then `repathTick = tick + CHASE_REPATH_TICKS`. */
function throttledRequest(ctx: SimContext, unit: UnitEntity, chase: ChaseState, goal: Parameters<typeof requestPath>[2]): void {
  if (ctx.state.tick < chase.repathTick) return;
  requestPath(ctx, unit, goal);
  chase.repathTick = ctx.state.tick + CHASE_REPATH_TICKS;
}

/**
 * One tick of chasing `target` (4.6), for a unit that is out of reach:
 * - too close (inside `minRange`): walk to a point `minRange + 0.5` from the target's nearest point, away from it;
 * - building target: `followPath` to the footprint; if the path is used up without reaching, re-request under the
 *   throttle;
 * - unit target within `CHASE_DIRECT_DISTANCE`: `directPath` towards it when the straight segment is walkable;
 * - otherwise a point path to the target's position, re-requested only when `tick >= repathTick` and the target is
 *   more than `CHASE_REPATH_DISTANCE` from the path's goal (or the path is gone or used up).
 * Every A* request obeys the `repathTick` throttle, so a chasing unit requests at most one path per
 * `CHASE_REPATH_TICKS` ticks (the footprint path of `followPath` excepted, which requests only when it has none).
 */
export function chase(ctx: SimContext, unit: UnitEntity, profile: ResolvedUnitCombat, target: Attackable, chaseState: ChaseState): void {
  const d2 = distSqToTarget(ctx, unit.pos.x, unit.pos.y, target);
  if (profile.minRange > 0 && d2 < profile.minRange * profile.minRange) {
    backOff(ctx, unit, profile, target, chaseState, d2);
    return;
  }
  if (target.kind === 'building') {
    const size = ctx.data.building(target.typeId).footprint;
    const path = unit.path;
    if (path !== null && path.nextIndex >= path.waypoints.length) {
      // At the footprint but not in reach (crowded or blocked): try again under the throttle.
      if (ctx.state.tick < chaseState.repathTick) return;
      unit.path = null;
    }
    if (unit.path === null && unit.pendingPathRequestId === null) {
      if (ctx.state.tick < chaseState.repathTick) return;
      chaseState.repathTick = ctx.state.tick + CHASE_REPATH_TICKS;
    }
    followPath(ctx, unit, { kind: 'footprint', tile: { tx: target.tile.tx, ty: target.tile.ty }, size });
    return;
  }
  if (d2 <= CHASE_DIRECT_DISTANCE * CHASE_DIRECT_DISTANCE && directPath(ctx, unit, target.pos.x, target.pos.y)) {
    unit.pendingPathRequestId = null;
    return;
  }
  if (unit.pendingPathRequestId !== null) return;
  const goal = pathGoal(unit);
  const used = unit.path !== null && unit.path.nextIndex >= unit.path.waypoints.length;
  if (goal !== null && !used) {
    const gx = target.pos.x - goal.x;
    const gy = target.pos.y - goal.y;
    if (gx * gx + gy * gy <= CHASE_REPATH_DISTANCE * CHASE_REPATH_DISTANCE) return;
  }
  throttledRequest(ctx, unit, chaseState, { kind: 'point', x: target.pos.x, y: target.pos.y });
}

/** Inside the minimum range: walk away from the target's nearest point (4.6, decided by WP21). */
function backOff(ctx: SimContext, unit: UnitEntity, profile: ResolvedUnitCombat, target: Attackable, chaseState: ChaseState, d2: number): void {
  if (unit.pendingPathRequestId !== null) return;
  if (unit.path !== null && unit.path.nextIndex < unit.path.waypoints.length) return;
  let nx: number;
  let ny: number;
  if (target.kind === 'unit') {
    nx = target.pos.x;
    ny = target.pos.y;
  } else {
    const size = ctx.data.building(target.typeId).footprint;
    nx = Math.min(Math.max(unit.pos.x, target.tile.tx), target.tile.tx + size);
    ny = Math.min(Math.max(unit.pos.y, target.tile.ty), target.tile.ty + size);
  }
  let vx = unit.pos.x - nx;
  let vy = unit.pos.y - ny;
  let len = Math.sqrt(d2);
  if (len === 0) {
    const a = targetAnchor(ctx, target);
    vx = unit.pos.x - a.x;
    vy = unit.pos.y - a.y;
    len = Math.sqrt(vx * vx + vy * vy);
    if (len === 0) {
      vx = 1;
      vy = 0;
      len = 1;
    }
  }
  const want = profile.minRange + 0.5;
  const w = ctx.state.map.width;
  const h = ctx.state.map.height;
  const gx = Math.min(w - 1 / 1024, Math.max(0, nx + (vx / len) * want));
  const gy = Math.min(h - 1 / 1024, Math.max(0, ny + (vy / len) * want));
  throttledRequest(ctx, unit, chaseState, { kind: 'point', x: gx, y: gy });
}

/** Outcome of one engagement tick. */
export type EngageResult =
  /** In reach: the unit stands (phase `attacking`). */
  | 'attacking'
  /** Out of reach and chasing. */
  | 'chasing'
  /** Out of reach and not allowed to move (stand-ground auto engagement, hold). */
  | 'outOfReach';

/**
 * One tick of an engagement against a valid `target` (4.6). While winding up the unit never moves. In reach it
 * stands; out of reach it chases when `mayChase`, else reports `outOfReach` (and stands).
 */
export function engage(
  ctx: SimContext,
  unit: UnitEntity,
  profile: ResolvedUnitCombat,
  target: Attackable,
  mayChase: boolean,
  chaseState: ChaseState,
): EngageResult {
  if (inReach(ctx, unit, profile, target)) {
    standStill(unit);
    return 'attacking';
  }
  if (!mayChase) {
    standStill(unit);
    return 'outOfReach';
  }
  if (unit.combat.windup > 0) {
    standStill(unit);
    return 'chasing';
  }
  chase(ctx, unit, profile, target, chaseState);
  return 'chasing';
}

/** The leash of 4.6: is `target` more than `leashRadius` from `anchor`? */
export function leashBroken(ctx: SimContext, anchor: Vec2, target: Attackable): boolean {
  const r = ctx.data.combat.leashRadius;
  return distSqToTarget(ctx, anchor.x, anchor.y, target) > r * r;
}

/**
 * The target `unit` is currently engaging for the purpose of starting a swing (4.3 step 3), or null: an `attack`
 * order in phase `attacking`, an `attackMove` in phase `engaging`, or a `hold` with a target. Reach and validity
 * are re-checked by the caller.
 */
export function engagedTargetId(unit: UnitEntity): EntityId | null {
  const o = unit.currentOrder;
  if (o === null) return null;
  if (o.type === 'attack') return o.phase === 'attacking' ? o.targetId : null;
  if (o.type === 'attackMove') return o.phase === 'engaging' ? o.targetId : null;
  if (o.type === 'hold') return o.targetId;
  return null;
}
