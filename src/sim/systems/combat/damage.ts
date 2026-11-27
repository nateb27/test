/**
 * Shared combat plumbing (PLAN-M2 3.5, 4.1, 4.14). Implemented for real in Phase 0 (WP20) so the parallel packages
 * build against working helpers; owned by WP21 (Combat core) afterwards. Signatures are contract: change them only
 * through the orchestrator.
 */

import { resolveBuildingCombat, resolveUnitCombat, resolvedStatTable } from '../../rules/stats';
import {
  ALERT_MIN_DISTANCE,
  ALERT_MIN_TICKS,
  NEUTRAL_PLAYER_ID,
  type ArmorClass,
  type AttackType,
  type BuildingEntity,
  type BuildingId,
  type Entity,
  type EntityId,
  type PlayerId,
  type ResolvedBuildingCombat,
  type ResolvedUnitCombat,
  type SimContext,
  type UnitEntity,
  type UnitId,
} from '../../types';
import { emit } from '../common';

/** `a` and `b` are hostile: different real players. No teams in M2; the neutral player 0 is nobody's enemy. */
export function isEnemy(a: PlayerId, b: PlayerId): boolean {
  return a !== b && a !== NEUTRAL_PLAYER_ID && b !== NEUTRAL_PLAYER_ID;
}

/** Resolved combat profile of a unit type for its owner (from `runtime.combat`, built on a miss). */
export function unitCombat(ctx: SimContext, owner: PlayerId, typeId: UnitId): ResolvedUnitCombat {
  const cached = ctx.runtime.combat[owner]?.[typeId];
  if (cached !== undefined && cached.kind === 'unit') return cached;
  const def = ctx.data.unit(typeId);
  const profile = resolveUnitCombat(ctx, def, resolvedStatTable(ctx, owner, def));
  const table = ctx.runtime.combat[owner];
  if (table !== undefined) table[typeId] = profile;
  return profile;
}

/** Resolved combat profile of a building type for its owner (from `runtime.combat`, built on a miss). */
export function buildingCombat(ctx: SimContext, owner: PlayerId, typeId: BuildingId): ResolvedBuildingCombat {
  const cached = ctx.runtime.combat[owner]?.[typeId];
  if (cached !== undefined && cached.kind === 'building') return cached;
  const def = ctx.data.building(typeId);
  const profile = resolveBuildingCombat(ctx, def, resolvedStatTable(ctx, owner, def));
  const table = ctx.runtime.combat[owner];
  if (table !== undefined) table[typeId] = profile;
  return profile;
}

/**
 * Damage formula of PLAN-M2 4.1. Pure; integers in, integer out:
 * `max(minDamage, attack - armor) + floor(sum of bonus[c] over target classes * (100 - bonusResist) / 100)`.
 * Bonus damage is added after armour; armour never reduces it.
 */
export function computeDamage(
  att: { attack: number; attackType: AttackType; bonus: Readonly<Partial<Record<ArmorClass, number>>> },
  def: { meleeArmor: number; pierceArmor: number; classes: readonly ArmorClass[]; bonusResist: number },
  minDamage: number,
): number {
  const armor = att.attackType === 'melee' ? def.meleeArmor : def.pierceArmor;
  let bonusRaw = 0;
  for (const c of def.classes) bonusRaw += att.bonus[c] ?? 0;
  const bonus = Math.floor((bonusRaw * (100 - def.bonusResist)) / 100);
  return Math.max(minDamage, att.attack - armor) + bonus;
}

/** Anchor of a unit (position) or building/node (footprint centre). */
function anchorOf(ctx: SimContext, target: Entity): { x: number; y: number } {
  if (target.kind === 'unit') return { x: target.pos.x, y: target.pos.y };
  const size = target.kind === 'building' ? ctx.data.building(target.typeId).footprint : ctx.data.node(target.typeId).footprint;
  return { x: target.tile.tx + size / 2, y: target.tile.ty + size / 2 };
}

/**
 * Apply `amount` damage to `target` from `attacker` (PLAN-M2 4.1, 4.5, 4.14):
 * - `hp -= amount`, clamped at 0 (integer in, integer out);
 * - `lastAttackerId = attacker.id` only if hp was > 0 before the hit; `lastDamagedTick = state.tick`;
 * - from an enemy: UnderAttack for the target's owner, throttled through `player.alert`
 *   (no alert yet, or ALERT_MIN_TICKS since the last, or at least ALERT_MIN_DISTANCE from it);
 * - retaliation wake-up: an idle (no order, empty queue) aggressive unit with `autoAcquire` gets
 *   `combat.nextScanTick = state.tick + 1`.
 */
export function applyDamage(
  ctx: SimContext,
  target: UnitEntity | BuildingEntity,
  amount: number,
  attacker: { id: EntityId; owner: PlayerId },
): void {
  const { state } = ctx;
  const wasAlive = target.hp > 0;
  target.hp = Math.max(0, target.hp - amount);
  if (wasAlive) target.lastAttackerId = attacker.id;
  target.lastDamagedTick = state.tick;

  if (isEnemy(attacker.owner, target.owner)) {
    const player = state.players[target.owner];
    if (player !== undefined) {
      const at = anchorOf(ctx, target);
      const last = player.alert;
      const far =
        last !== null &&
        (at.x - last.x) * (at.x - last.x) + (at.y - last.y) * (at.y - last.y) >= ALERT_MIN_DISTANCE * ALERT_MIN_DISTANCE;
      if (last === null || state.tick - last.tick >= ALERT_MIN_TICKS || far) {
        player.alert = { tick: state.tick, x: at.x, y: at.y };
        emit(ctx, {
          type: 'UnderAttack',
          playerId: target.owner,
          entityId: target.id,
          entityKind: target.kind,
          townCenter: target.kind === 'building' && ctx.data.building(target.typeId).tags.includes('townCenter'),
          x: at.x,
          y: at.y,
          attackerPlayerId: attacker.owner,
        });
      }
    }
  }

  if (
    target.kind === 'unit' &&
    target.currentOrder === null &&
    target.orderQueue.length === 0 &&
    target.stance === 'aggressive' &&
    unitCombat(ctx, target.owner, target.typeId).autoAcquire
  ) {
    target.combat.nextScanTick = state.tick + 1;
  }
}

/** Squared distance from a point to a target: unit centre, or nearest point of a building/node footprint. */
export function distSqToTarget(ctx: SimContext, x: number, y: number, target: Entity): number {
  if (target.kind === 'unit') {
    const dx = target.pos.x - x;
    const dy = target.pos.y - y;
    return dx * dx + dy * dy;
  }
  const size = target.kind === 'building' ? ctx.data.building(target.typeId).footprint : ctx.data.node(target.typeId).footprint;
  const nx = Math.min(Math.max(x, target.tile.tx), target.tile.tx + size);
  const ny = Math.min(Math.max(y, target.tile.ty), target.tile.ty + size);
  const dx = nx - x;
  const dy = ny - y;
  return dx * dx + dy * dy;
}
