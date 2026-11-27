/**
 * Unit attacks (PLAN-M2 4.3): tick step 8a. Owned by WP21 (Combat core).
 */

import { findEntity } from '../../entities';
import { TICK_RATE, type ResolvedUnitCombat, type SimContext, type UnitEntity } from '../../types';
import { facingFromDelta } from '../movement';
import { spawnProjectile } from '../projectiles';
import { applyDamage, distSqToTarget, unitCombat } from './damage';
import { damageAgainst, engagedTargetId, inReach, targetAnchor, targetFor } from './engage';

/**
 * Release of a wind-up (4.3 step 2): melee damage within reach + slack, or a projectile at a target that exists and
 * still has hp > 0.
 */
function release(ctx: SimContext, unit: UnitEntity, profile: ResolvedUnitCombat): void {
  const id = unit.combat.swingTargetId;
  const target = id === null ? undefined : findEntity(ctx.state, id);
  // A target already at 0 hp (killed earlier in this step) is no longer a target (4.2): the blow or shot is wasted.
  // It would change nothing anyway (hp is clamped at 0 and a dead target takes no credit), except a pointless
  // projectile in flight and an UnderAttack alert for a unit that is about to be removed.
  if (target === undefined || target.kind === 'node' || target.hp <= 0) return;
  if (profile.projectile === null) {
    const r = profile.reach + ctx.data.combat.meleeReleaseSlack;
    if (distSqToTarget(ctx, unit.pos.x, unit.pos.y, target) > r * r) return; // wasted blow
    applyDamage(ctx, target, damageAgainst(ctx, profile, target), { id: unit.id, owner: unit.owner });
    return;
  }
  const to = targetAnchor(ctx, target);
  const dx = to.x - unit.pos.x;
  const dy = to.y - unit.pos.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const speed = ctx.data.combat.projectileSpeed[profile.projectile];
  const flightTicks = speed > 0 ? Math.max(1, Math.ceil((dist * TICK_RATE) / speed)) : 1;
  spawnProjectile(ctx, {
    kind: profile.projectile,
    owner: unit.owner,
    sourceId: unit.id,
    sourceType: unit.typeId,
    targetId: target.id,
    from: { x: unit.pos.x, y: unit.pos.y },
    to,
    flightTicks,
    damage: damageAgainst(ctx, profile, target),
  });
}

/**
 * Step 8a, per unit in ascending id (4.3):
 * 1. `cooldown -= 1` if > 0;
 * 2. while winding up: `windup -= 1`; at 0 release (melee damage through `applyDamage` if the swing target is
 *    within reach + `meleeReleaseSlack`, else wasted; ranged: `spawnProjectile` if the target exists), then
 *    `cooldown = cooldownTicks - windupTicks`, `lastAttackTick = tick`, `swingTargetId = null`;
 * 3. otherwise, with `cooldown === 0` and an engagement (attack `attacking`, attack-move `engaging`, hold with a
 *    target) whose target is valid and in reach: start a wind-up and face the target.
 * A unit with hp 0 (dies in step 11) still completes a release but starts no new swing.
 */
export function runUnitAttacks(ctx: SimContext): void {
  for (const unit of ctx.state.entities) {
    if (unit.kind !== 'unit') continue;
    const c = unit.combat;
    if (c.cooldown > 0) c.cooldown -= 1;
    if (c.windup > 0) {
      const profile = unitCombat(ctx, unit.owner, unit.typeId);
      c.windup -= 1;
      if (c.windup === 0) {
        release(ctx, unit, profile);
        c.cooldown = Math.max(0, profile.cooldownTicks - profile.windupTicks);
        c.lastAttackTick = ctx.state.tick;
        c.swingTargetId = null;
      }
      continue;
    }
    if (c.cooldown !== 0 || unit.hp <= 0) continue;
    const targetId = engagedTargetId(unit);
    if (targetId === null) continue;
    const profile = unitCombat(ctx, unit.owner, unit.typeId);
    const target = targetFor(ctx, unit, profile, targetId);
    if (target === undefined || !inReach(ctx, unit, profile, target)) continue;
    c.windup = profile.windupTicks;
    c.swingTargetId = target.id;
    const a = targetAnchor(ctx, target);
    const facing = facingFromDelta(a.x - unit.pos.x, a.y - unit.pos.y);
    if (facing !== null) unit.facing = facing;
  }
}
