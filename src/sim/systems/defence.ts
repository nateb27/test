/**
 * Building attacks (PLAN-M2 4.10): tick step 8b, Town Center arrows. Owned by WP22 (Projectiles and defence).
 */

import { findEntity } from '../entities';
import {
  ACQUIRE_INTERVAL_TICKS,
  ACQUIRE_MAX_CHECKS_PER_SCAN,
  SPATIAL_QUERY_PAD,
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

/**
 * Step 8b, per completed building with `combat.attack` in ascending id: cooldown, target scan (unit scheduling and
 * budget), volleys of `arrows` projectiles through `spawnProjectile`. A building acts whatever its hp.
 *
 * - `cooldown -= 1` if > 0. The held target is kept while it is a living enemy unit in reach (measured from the
 *   footprint centre to the unit centre, current positions).
 * - Without a valid target and when due (`tick >= nextScanTick`, budget left), scan units within reach plus
 *   `SPATIAL_QUERY_PAD`: lowest (tier, d squared, id). A scan costs at most `ACQUIRE_MAX_CHECKS_PER_SCAN` checks from
 *   `runtime.acquireBudget` and sets `nextScanTick = tick + ACQUIRE_INTERVAL_TICKS`; with no budget left it stays due.
 * - At cooldown 0 with a target, `arrows` projectiles are fired at it and `cooldown = cooldownTicks`.
 */
export function runBuildingAttacks(ctx: SimContext): void {
  const { state, runtime } = ctx;
  for (const b of state.entities) {
    if (b.kind !== 'building' || b.attack === null || !b.constructed) continue;
    const atk = b.attack;
    const prof = buildingCombat(ctx, b.owner, b.typeId).attack;
    if (prof === null) continue;
    if (atk.cooldown > 0) atk.cooldown -= 1;

    const centre = anchorOf(ctx, b);
    const reach2 = prof.reach * prof.reach;
    const valid = (u: UnitEntity): boolean =>
      u.hp > 0 && isEnemy(b.owner, u.owner) && distSqToTarget(ctx, centre.x, centre.y, u) <= reach2;

    let target: UnitEntity | null = null;
    if (atk.targetId !== null) {
      const held = findEntity(state, atk.targetId);
      if (held !== undefined && held.kind === 'unit' && valid(held)) target = held;
      else atk.targetId = null;
    }

    if (target === null && state.tick >= atk.nextScanTick && runtime.acquireBudget > 0) {
      target = scanForTarget(ctx, b, centre, prof.reach, reach2);
      atk.targetId = target === null ? null : target.id;
      atk.nextScanTick = state.tick + ACQUIRE_INTERVAL_TICKS;
    }

    if (target === null || atk.cooldown > 0) continue;
    fireVolley(ctx, b, centre, target);
  }
}

function scanForTarget(ctx: SimContext, b: BuildingEntity, centre: Point, reach: number, reach2: number): UnitEntity | null {
  let best: UnitEntity | null = null;
  let bestTier = 0;
  let bestD2 = 0;
  const budget = Math.min(ACQUIRE_MAX_CHECKS_PER_SCAN, ctx.runtime.acquireBudget);
  const used = visitUnitsNear(ctx, centre.x, centre.y, reach + SPATIAL_QUERY_PAD, budget, (u) => {
    if (u.hp <= 0 || !isEnemy(b.owner, u.owner)) return false;
    const d2 = distSqToTarget(ctx, centre.x, centre.y, u);
    if (d2 > reach2) return false;
    const tier = unitTier(ctx, u);
    if (best === null || tier < bestTier || (tier === bestTier && (d2 < bestD2 || (d2 === bestD2 && u.id < best.id)))) {
      best = u;
      bestTier = tier;
      bestD2 = d2;
    }
    return false;
  });
  ctx.runtime.acquireBudget = Math.max(0, ctx.runtime.acquireBudget - used);
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
