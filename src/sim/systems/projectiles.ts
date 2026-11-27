/**
 * Projectiles (PLAN-M2 2.4, 4.4): tick step 9. Owned by WP22 (Projectiles and defence).
 *
 * `state.projectiles` is kept sorted by id; ids come from `state.nextProjectileId` (separate from entity ids).
 */

import { findEntity } from '../entities';
import {
  NEUTRAL_PLAYER_ID,
  TICK_RATE,
  type ArmorClass,
  type AttackType,
  type BuildingEntity,
  type Entity,
  type Projectile,
  type ProjectileKind,
  type SimContext,
  type UnitEntity,
  type Vec2,
} from '../types';
import { applyDamage, buildingCombat, computeDamage, isEnemy, unitCombat } from './combat/damage';
import { visitBuildingsNear, visitUnitsNear } from './combat/spatial';

/**
 * Fire a projectile: allocate an id, set `ticksLeft = flightTicks` and append (ids only grow, so the list stays
 * sorted). The caller computes `flightTicks = max(1, ceil(dist * TICK_RATE / speed))` and the damage.
 * Implemented in Phase 0 (WP20); the signature is contract.
 */
export function spawnProjectile(ctx: SimContext, spec: Omit<Projectile, 'id' | 'ticksLeft'>): void {
  const id = ctx.state.nextProjectileId;
  ctx.state.nextProjectileId = id + 1;
  ctx.state.projectiles.push({
    id,
    kind: spec.kind,
    owner: spec.owner,
    sourceId: spec.sourceId,
    sourceType: spec.sourceType,
    targetId: spec.targetId,
    from: { x: spec.from.x, y: spec.from.y },
    to: { x: spec.to.x, y: spec.to.y },
    flightTicks: spec.flightTicks,
    ticksLeft: spec.flightTicks,
    damage: spec.damage,
  });
}

/** Flight time of a shot over `dist` tiles at the kind's speed (PLAN-M2 2.4): `max(1, ceil(dist * TICK_RATE / speed))`. */
export function projectileFlightTicks(ctx: SimContext, kind: ProjectileKind, dist: number): number {
  const speed = ctx.data.combat.projectileSpeed[kind];
  return Math.max(1, Math.ceil((dist * TICK_RATE) / speed));
}

/** Anchor of a unit (position) or building (footprint centre), as a fresh object. */
export function anchorOf(ctx: SimContext, target: UnitEntity | BuildingEntity): Vec2 {
  if (target.kind === 'unit') return { x: target.pos.x, y: target.pos.y };
  const size = ctx.data.building(target.typeId).footprint;
  return { x: target.tile.tx + size / 2, y: target.tile.ty + size / 2 };
}

function isDamageable(e: Entity | undefined): e is UnitEntity | BuildingEntity {
  return e !== undefined && (e.kind === 'unit' || e.kind === 'building');
}

/** Damage a resolved attacker profile deals to `target` (4.1). */
function damageVs(
  ctx: SimContext,
  att: { attack: number; attackType: AttackType; bonus: Readonly<Partial<Record<ArmorClass, number>>> },
  target: UnitEntity | BuildingEntity,
): number {
  const def = target.kind === 'unit' ? unitCombat(ctx, target.owner, target.typeId) : buildingCombat(ctx, target.owner, target.typeId);
  return computeDamage(att, def, ctx.data.combat.minDamage);
}

/** Fire splash (4.4): every living enemy unit and building within the radius of `p.to`, except the primary target. */
function applySplash(ctx: SimContext, p: Projectile): void {
  if (p.kind !== 'fire' || p.owner === NEUTRAL_PLAYER_ID || ctx.data.def(p.sourceType)?.kind !== 'unit') return;
  const src = unitCombat(ctx, p.owner, p.sourceType);
  if (src.splash === null) return;
  const { radius, percent } = src.splash;
  const hit: (UnitEntity | BuildingEntity)[] = [];
  const collect = (e: UnitEntity | BuildingEntity): boolean => {
    if (e.id !== p.targetId && e.hp > 0 && isEnemy(p.owner, e.owner)) hit.push(e);
    return false;
  };
  // No budget: splash must not depend on the visiting order.
  visitUnitsNear(ctx, p.to.x, p.to.y, radius, Number.MAX_SAFE_INTEGER, collect);
  visitBuildingsNear(ctx, p.to.x, p.to.y, radius, Number.MAX_SAFE_INTEGER, collect);
  // Units and buildings share one id space; ascending id makes events and alerts independent of the grid order.
  hit.sort((a, b) => a.id - b.id);
  for (const e of hit) {
    const amount = Math.max(1, Math.floor((damageVs(ctx, src, e) * percent) / 100));
    applyDamage(ctx, e, amount, { id: p.sourceId, owner: p.owner });
  }
}

/**
 * Tick step 9 (PLAN-M2 2.4, 4.4): per projectile in ascending id, while the target exists `to` follows its anchor;
 * `ticksLeft -= 1`; at 0 the projectile impacts and is removed. On impact the primary target (if it still exists
 * with hp > 0) takes `damage`, credited to the shooter even if it has died; fire then splashes (also when the
 * primary is gone). Damage is a sum of integers, so impacts do not depend on iteration order.
 */
export function runProjectiles(ctx: SimContext): void {
  const list = ctx.state.projectiles;
  if (list.length === 0) return;
  const keep: Projectile[] = [];
  for (const p of list) {
    const target = findEntity(ctx.state, p.targetId);
    if (isDamageable(target)) {
      const at = anchorOf(ctx, target);
      p.to.x = at.x;
      p.to.y = at.y;
    }
    p.ticksLeft -= 1;
    if (p.ticksLeft > 0) {
      keep.push(p);
      continue;
    }
    if (isDamageable(target) && target.hp > 0 && isEnemy(p.owner, target.owner)) {
      applyDamage(ctx, target, p.damage, { id: p.sourceId, owner: p.owner });
    }
    applySplash(ctx, p);
  }
  ctx.state.projectiles = keep;
}
