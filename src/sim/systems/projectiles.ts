/**
 * Projectiles (PLAN-M2 2.4, 4.4): tick step 9. Owned by WP22 (Projectiles and defence).
 *
 * `state.projectiles` is kept sorted by id; ids come from `state.nextProjectileId` (separate from entity ids).
 */

import type { Projectile, SimContext } from '../types';

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

/**
 * Tick step 9: advance every projectile (homing: `to` follows the target's anchor while it exists), resolve impacts
 * (damage through `applyDamage`, fire splash) and remove spent projectiles.
 *
 * STUB (TODO(WP22)): only decrements `ticksLeft` and drops projectiles that reach 0; no homing, no damage.
 */
export function runProjectiles(ctx: SimContext): void {
  const list = ctx.state.projectiles;
  if (list.length === 0) return;
  for (const p of list) p.ticksLeft -= 1;
  ctx.state.projectiles = list.filter((p) => p.ticksLeft > 0);
}
