/**
 * Building attacks (PLAN-M2 4.10): Town Center arrows. Target scans run in tick step 4 (`scanBuildingTarget`,
 * called from `runAcquisition`), volleys in step 8b (`runBuildingAttacks`). Owned by WP22 (Projectiles and defence).
 */

import { findEntity } from '../entities';
import {
  ACQUIRE_INTERVAL_TICKS,
  ACQUIRE_MAX_CHECKS_PER_SCAN,
  type BuildingEntity,
  type SimContext,
  type UnitEntity,
} from '../types';
import { buildingCombat, computeDamage, distSqToTarget, isEnemy, unitCombat } from './combat/damage';
import { visitUnitsNear } from './combat/spatial';
import { anchorOf, projectileFlightTicks, spawnProjectile } from './projectiles';

interface Point {
  x: number;
  y: number;
}

/** Tier of a candidate: 1 = fighting unit (`autoAcquire`, targets any), 2 = any other unit. */
function unitTier(ctx: SimContext, u: UnitEntity): number {
  const c = unitCombat(ctx, u.owner, u.typeId);
  return c.autoAcquire && c.targets === 'any' ? 1 : 2;
}

/** Is `u` a target the building may shoot from `centre` (living enemy unit within reach, current positions)? */
function validTarget(ctx: SimContext, b: BuildingEntity, centre: Point, reach2: number, u: UnitEntity): boolean {
  return u.hp > 0 && isEnemy(b.owner, u.owner) && distSqToTarget(ctx, centre.x, centre.y, u) <= reach2;
}

/** The building's held target if it is still valid, else undefined. */
function heldTarget(ctx: SimContext, b: BuildingEntity, centre: Point, reach2: number): UnitEntity | undefined {
  const id = b.attack?.targetId ?? null;
  if (id === null) return undefined;
  const held = findEntity(ctx.state, id);
  return held !== undefined && held.kind === 'unit' && validTarget(ctx, b, centre, reach2, held) ? held : undefined;
}

/**
 * Target scan of a building (PLAN-M2 2.2 step 4, 4.10), called by `runAcquisition` in ascending id among the unit
 * scans so that buildings follow the unit scheduling and share `runtime.acquireBudget`. Only completed living
 * buildings with `combat.attack` scan, and only when due (`tick >= nextScanTick`), without a valid held target (the
 * building keeps its target while it is in reach), and with a full scan's checks left in the budget (else it stays
 * due, like a unit). The scan looks at units within reach (positions are those of the index rebuild, so no pad is
 * needed): lowest (tier, d squared, id), tier 1 = `autoAcquire` and `targets: 'any'`, tier 2 = other units. Then
 * `nextScanTick = tick + ACQUIRE_INTERVAL_TICKS`.
 */
export function scanBuildingTarget(ctx: SimContext, b: BuildingEntity): void {
  const atk = b.attack;
  if (atk === null || !b.constructed || b.hp <= 0 || ctx.state.tick < atk.nextScanTick) return;
  const prof = buildingCombat(ctx, b.owner, b.typeId).attack;
  if (prof === null) return;
  const centre = anchorOf(ctx, b);
  const reach2 = prof.reach * prof.reach;
  if (heldTarget(ctx, b, centre, reach2) !== undefined) return;
  if (ctx.runtime.acquireBudget < ACQUIRE_MAX_CHECKS_PER_SCAN) return;
  const target = scanForTarget(ctx, b, centre, prof.reach, reach2);
  atk.targetId = target === null ? null : target.id;
  atk.nextScanTick = ctx.state.tick + ACQUIRE_INTERVAL_TICKS;
}

/**
 * Step 8b, per completed building with `combat.attack` in ascending id (4.10). A building acts whatever its hp.
 *
 * - `cooldown -= 1` if > 0.
 * - The held target (chosen by the step-4 scan) is re-checked against current positions: a living enemy unit within
 *   reach of the footprint centre. Otherwise it is dropped and the building scans again next tick
 *   (`nextScanTick <= tick + 1`, the 4.6 rule for a target that is gone).
 * - At cooldown 0 with a target, `arrows` projectiles are fired at it and `cooldown = cooldownTicks`.
 */
export function runBuildingAttacks(ctx: SimContext): void {
  const { state } = ctx;
  for (const b of state.entities) {
    if (b.kind !== 'building' || b.attack === null || !b.constructed) continue;
    const atk = b.attack;
    const prof = buildingCombat(ctx, b.owner, b.typeId).attack;
    if (prof === null) continue;
    if (atk.cooldown > 0) atk.cooldown -= 1;
    if (atk.targetId === null) continue;
    const centre = anchorOf(ctx, b);
    const target = heldTarget(ctx, b, centre, prof.reach * prof.reach);
    if (target === undefined) {
      atk.targetId = null;
      atk.nextScanTick = Math.min(atk.nextScanTick, state.tick + 1);
      continue;
    }
    if (atk.cooldown > 0) continue;
    fireVolley(ctx, b, centre, target);
  }
}

function scanForTarget(ctx: SimContext, b: BuildingEntity, centre: Point, reach: number, reach2: number): UnitEntity | null {
  let best: UnitEntity | null = null;
  let bestTier = 0;
  let bestD2 = 0;
  const used = visitUnitsNear(ctx, centre.x, centre.y, reach, ACQUIRE_MAX_CHECKS_PER_SCAN, (u) => {
    if (!validTarget(ctx, b, centre, reach2, u)) return false;
    const d2 = distSqToTarget(ctx, centre.x, centre.y, u);
    const tier = unitTier(ctx, u);
    if (best === null || tier < bestTier || (tier === bestTier && (d2 < bestD2 || (d2 === bestD2 && u.id < best.id)))) {
      best = u;
      bestTier = tier;
      bestD2 = d2;
    }
    return false;
  });
  ctx.runtime.acquireBudget -= used;
  return best;
}

function fireVolley(ctx: SimContext, b: BuildingEntity, centre: Point, target: UnitEntity): void {
  const prof = buildingCombat(ctx, b.owner, b.typeId).attack;
  const atk = b.attack;
  if (prof === null || atk === null) return;
  const dx = target.pos.x - centre.x;
  const dy = target.pos.y - centre.y;
  const flightTicks = projectileFlightTicks(ctx, prof.projectile, Math.sqrt(dx * dx + dy * dy));
  const damage = computeDamage(
    { attack: prof.attack, attackType: prof.attackType, bonus: {} },
    unitCombat(ctx, target.owner, target.typeId),
    ctx.data.combat.minDamage,
  );
  for (let i = 0; i < prof.arrows; i++) {
    spawnProjectile(ctx, {
      kind: prof.projectile,
      owner: b.owner,
      sourceId: b.id,
      sourceType: b.typeId,
      targetId: target.id,
      from: { x: centre.x, y: centre.y },
      to: { x: target.pos.x, y: target.pos.y },
      flightTicks,
      damage,
    });
  }
  atk.cooldown = prof.cooldownTicks;
  atk.lastAttackTick = ctx.state.tick;
}
