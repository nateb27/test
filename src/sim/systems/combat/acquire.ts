/**
 * Acquisition (PLAN-M2 4.5): tick step 4. Owned by WP21 (Combat core).
 *
 * Scanning situations of a living unit (anything else never scans):
 * - idle (no order, nothing queued) with `autoAcquire`: aggressive scans within `sight`, stand ground within reach
 *   only; a hit gets an `attack{auto:true}` order with the unit's position as leash anchor;
 * - `attack{auto:true}` whose target is out of reach: retarget scan (in reach only);
 * - `attackMove` walking: scans within `sight`; a hit switches the order to `engaging` (anchor = position);
 *   engaging with the target out of reach: retarget scan;
 * - `hold` without a target in reach (units with `autoAcquire`): scan within reach.
 * Commanded attacks, moves and economic orders never scan; villagers (`autoAcquire: false`) never scan.
 *
 * Hardened buildings (`isHardened`, WP33: the unit's damage per blow is at most `minDamage`) are tier 4, below every
 * other candidate, never the tier-0 last attacker, and no candidate at all for an attack-move that is still walking:
 * an army attack-moving past a Town Center walks on and fights the units it meets; once idle (arrived) it takes the
 * Town Center only when nothing else is in the scan radius. A unit engaging a hardened building (auto or attack-move; hold in reach)
 * rescans every interval, whether or not the building is in reach, and switches to anything of tier 3 or lower.
 * Siege is never hardened against, so it keeps preferring buildings.
 *
 * Building scans (Town Center) run in the same ascending-id pass (`scanBuildingTarget`, `defence.ts`), with the same
 * due/budget rules and the shared `runtime.acquireBudget` (PLAN-M2 2.2 step 4, 4.10); step 8b only fires.
 */

import {
  ACQUIRE_BUDGET_PER_TICK,
  ACQUIRE_INTERVAL_TICKS,
  ACQUIRE_MAX_CHECKS_PER_SCAN,
  type ResolvedUnitCombat,
  type SimContext,
  type UnitEntity,
} from '../../types';
import { distSqToTarget, unitCombat } from './damage';
import { autoTier, canTarget, inReach, inReachSq, isHardened, standStill, targetFor, type Attackable } from './engage';
import { scanBuildingTarget } from '../defence';
import { rebuildSpatialIndex, visitBuildingsNear, visitUnitsNear } from './spatial';

/**
 * Ticks after being damaged during which the tier-0 retaliation radius (`retaliateRadius`, beyond sight) applies to
 * an idle aggressive unit's last attacker. Decided by WP21: retaliation answers a recent hit, not an old one.
 */
export const RETALIATE_WINDOW_TICKS = 2 * ACQUIRE_INTERVAL_TICKS;

/** A scan result: the best candidate by (tier, d², id). */
export interface ScanHit {
  target: Attackable;
  tier: number;
  d2: number;
}

export interface ScanOptions {
  /** Search radius around the unit (sight, or reach). */
  radius: number;
  /** Only candidates in reach (4.2) qualify. */
  inReachOnly: boolean;
  /** Only candidates of at most this tier qualify (retargeting). */
  maxTier: number;
  /** Radius within which the last attacker qualifies as tier 0 (>= radius), or null to use `radius`. */
  retaliateRadius: number | null;
}

function better(tier: number, d2: number, id: number, best: ScanHit | null): boolean {
  if (best === null) return true;
  if (tier !== best.tier) return tier < best.tier;
  if (d2 !== best.d2) return d2 < best.d2;
  return id < best.target.id;
}

/**
 * One target scan for `unit` (4.5): tier 0 is the unit's last attacker (valid and within the retaliation radius,
 * or in reach when `inReachOnly`), then enemy units (tier 1 fighting, tier 2 others), then enemy buildings (tier 3,
 * looked up only when no unit qualifies). Ties by d², then id. Spends at most `budget` checks; returns the hit (or
 * null) and the checks used.
 */
export function scanForTarget(
  ctx: SimContext,
  unit: UnitEntity,
  profile: ResolvedUnitCombat,
  opts: ScanOptions,
  budget: number,
): { hit: ScanHit | null; checks: number } {
  const { x, y } = unit.pos;
  const r2 = opts.radius * opts.radius;
  const qualifies = (d2: number, limit2: number): boolean => (opts.inReachOnly ? inReachSq(profile, d2) : d2 <= limit2);

  const last = targetFor(ctx, unit, profile, unit.lastAttackerId);
  // A hardened last attacker (a Town Center hitting infantry) is no tier-0 target: it competes in tier 4 below.
  if (last !== undefined && !isHardened(ctx, profile, last)) {
    const d2 = distSqToTarget(ctx, x, y, last);
    const rr = opts.retaliateRadius ?? opts.radius;
    if (qualifies(d2, rr * rr)) return { hit: { target: last, tier: 0, d2 }, checks: 0 };
  }

  let best: ScanHit | null = null;
  let checks = 0;
  if (profile.targets === 'any' && opts.maxTier >= 1) {
    checks += visitUnitsNear(ctx, x, y, opts.radius, budget, (u) => {
      // `u` is the state's own entity object (the index holds them), so no id lookup is needed (WP33).
      if (!canTarget(unit, profile, u)) return false;
      const d2 = distSqToTarget(ctx, x, y, u);
      if (!qualifies(d2, r2)) return false;
      const tier = autoTier(ctx, profile, u);
      if (tier > opts.maxTier) return false;
      if (better(tier, d2, u.id, best)) best = { target: u, tier, d2 };
      return false;
    });
    if (best !== null) return { hit: best, checks };
  }
  if (opts.maxTier >= 3) {
    checks += visitBuildingsNear(ctx, x, y, opts.radius, budget - checks, (b) => {
      if (!canTarget(unit, profile, b)) return false;
      const d2 = distSqToTarget(ctx, x, y, b);
      if (!qualifies(d2, r2)) return false;
      const tier = autoTier(ctx, profile, b);
      if (tier > opts.maxTier) return false;
      if (better(tier, d2, b.id, best)) best = { target: b, tier, d2 };
      return false;
    });
  }
  return { hit: best, checks };
}

/**
 * Rescan of a unit engaging a hardened building (WP33): every interval, look for anything better (tier 3 or lower)
 * within `sight` (an aggressive auto engagement or any attack-move) or reach (stand ground), whether or not the
 * building is in reach, so a unit scratching a Town Center turns on the units that come into sight.
 */
function hardenedRescan(unit: UnitEntity, profile: ResolvedUnitCombat, attackMove: boolean): ScanOptions {
  const sight = attackMove || unit.stance === 'aggressive';
  return { radius: sight ? profile.sight : profile.reach, inReachOnly: !sight, maxTier: 3, retaliateRadius: null };
}

/** What a due unit would scan for this tick, or null if it is in no scanning situation. */
function scanPlan(ctx: SimContext, unit: UnitEntity, profile: ResolvedUnitCombat): ScanOptions | null {
  const order = unit.currentOrder;
  const sightOrReach = unit.stance === 'aggressive' ? profile.sight : profile.reach;
  if (order === null) {
    if (unit.orderQueue.length > 0 || !profile.autoAcquire) return null;
    if (unit.stance === 'standGround') return { radius: profile.reach, inReachOnly: true, maxTier: 4, retaliateRadius: null };
    const recent = unit.lastDamagedTick !== null && ctx.state.tick - unit.lastDamagedTick <= RETALIATE_WINDOW_TICKS;
    const retaliate = recent ? Math.max(profile.sight, ctx.data.combat.retaliateRadius) : null;
    return { radius: sightOrReach, inReachOnly: false, maxTier: 4, retaliateRadius: retaliate };
  }
  switch (order.type) {
    case 'attack': {
      if (!order.auto) return null;
      const target = targetFor(ctx, unit, profile, order.targetId);
      if (target === undefined) return null;
      if (isHardened(ctx, profile, target)) return hardenedRescan(unit, profile, false);
      if (inReach(ctx, unit, profile, target)) return null;
      return { radius: profile.reach, inReachOnly: true, maxTier: autoTier(ctx, profile, target), retaliateRadius: null };
    }
    case 'attackMove': {
      // Walking: hardened buildings (tier 4) are not candidates; the army walks on past them (WP33).
      if (order.phase !== 'engaging') return { radius: profile.sight, inReachOnly: false, maxTier: 3, retaliateRadius: null };
      const target = targetFor(ctx, unit, profile, order.targetId);
      if (target === undefined) return null;
      if (isHardened(ctx, profile, target)) return hardenedRescan(unit, profile, true);
      if (inReach(ctx, unit, profile, target)) return null;
      return { radius: profile.reach, inReachOnly: true, maxTier: autoTier(ctx, profile, target), retaliateRadius: null };
    }
    case 'hold': {
      if (!profile.autoAcquire) return null;
      const target = targetFor(ctx, unit, profile, order.targetId);
      if (target !== undefined && inReach(ctx, unit, profile, target)) {
        return isHardened(ctx, profile, target) ? { radius: profile.reach, inReachOnly: true, maxTier: 3, retaliateRadius: null } : null;
      }
      return { radius: profile.reach, inReachOnly: true, maxTier: 4, retaliateRadius: null };
    }
    default:
      return null;
  }
}

/** Apply a scan hit to the unit's situation (new auto attack, engagement, retarget or hold target). */
function applyHit(ctx: SimContext, unit: UnitEntity, hit: ScanHit): void {
  const order = unit.currentOrder;
  if (order === null) {
    standStill(unit);
    unit.currentOrder = {
      type: 'attack',
      targetId: hit.target.id,
      auto: true,
      phase: 'start',
      anchor: { x: unit.pos.x, y: unit.pos.y },
      repathTick: ctx.state.tick,
    };
    return;
  }
  if (order.type === 'attack') {
    order.targetId = hit.target.id;
  } else if (order.type === 'attackMove') {
    if (order.phase !== 'engaging') {
      standStill(unit);
      order.phase = 'engaging';
      order.anchor = { x: unit.pos.x, y: unit.pos.y };
      order.repathTick = ctx.state.tick;
    }
    order.targetId = hit.target.id;
  } else if (order.type === 'hold') {
    order.targetId = hit.target.id;
  }
}

/**
 * Step 4: rebuild the spatial index, reset `runtime.acquireBudget`, then run the target scans of due units and
 * buildings (`scanBuildingTarget`) in ascending id (due: `tick >= combat.nextScanTick` and in a scanning situation). A scan spends at most
 * `ACQUIRE_MAX_CHECKS_PER_SCAN` checks out of the tick's budget; a due unit that finds the budget exhausted (fewer
 * than `ACQUIRE_MAX_CHECKS_PER_SCAN` checks left, so no scan is ever cut short by the tick budget) keeps its
 * `nextScanTick` and scans next tick. After a scan, `nextScanTick = tick + ACQUIRE_INTERVAL_TICKS`.
 */
export function runAcquisition(ctx: SimContext): void {
  rebuildSpatialIndex(ctx);
  ctx.runtime.acquireBudget = ACQUIRE_BUDGET_PER_TICK;
  const tick = ctx.state.tick;
  for (const e of ctx.state.entities) {
    if (e.kind === 'building') {
      if (e.attack !== null) scanBuildingTarget(ctx, e);
      continue;
    }
    if (e.kind !== 'unit' || e.hp <= 0 || tick < e.combat.nextScanTick) continue;
    const profile = unitCombat(ctx, e.owner, e.typeId);
    const plan = scanPlan(ctx, e, profile);
    if (plan === null) continue;
    // "Exhausted" = less than one full scan's checks left, so a scan is never cut short by the tick budget.
    if (ctx.runtime.acquireBudget < ACQUIRE_MAX_CHECKS_PER_SCAN) continue;
    const { hit, checks } = scanForTarget(ctx, e, profile, plan, ACQUIRE_MAX_CHECKS_PER_SCAN);
    ctx.runtime.acquireBudget -= checks;
    e.combat.nextScanTick = tick + ACQUIRE_INTERVAL_TICKS;
    if (hit !== null) applyHit(ctx, e, hit);
  }
}
