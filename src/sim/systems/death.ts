/**
 * Death (PLAN-M2 2.5, 4.9): tick step 11, before the existing cleanup. Owned by WP23 (Death and outcome).
 */

import { findEntity } from '../entities';
import type { Entity, EntityId, PlayerId, SimContext } from '../types';
import { emit } from './common';
import { recordStat } from './matchStats';

/** Insert `id` into the ascending list `ids` unless already present. */
function insertSorted(ids: EntityId[], id: EntityId): void {
  let i = 0;
  while (i < ids.length && (ids[i] as EntityId) < id) i++;
  if (ids[i] !== id) ids.splice(i, 0, id);
}

/**
 * Player credited with the death of `e`: the owner of `lastAttackerId` while that entity still exists, else the
 * owner of the lowest-id projectile still in flight from that attacker, else null. Never the victim's own owner.
 */
function killerOf(ctx: SimContext, e: Entity): PlayerId | null {
  if (e.kind === 'node') return null;
  const attackerId = e.lastAttackerId;
  if (attackerId === null) return null;
  const attacker = findEntity(ctx.state, attackerId);
  let killer: PlayerId | null = null;
  if (attacker !== undefined) killer = attacker.owner;
  else {
    for (const p of ctx.state.projectiles) {
      if (p.sourceId === attackerId) {
        killer = p.owner;
        break;
      }
    }
  }
  return killer === null || killer === 0 || killer === e.owner ? null : killer;
}

/**
 * Step 11: every unit and building with `hp <= 0` emits `UnitDied` / `BuildingDestroyed` (kill credit from
 * `lastAttackerId`, else a still-flying projectile's owner), updates stats through `recordStat`, has its queue
 * discarded without refund (buildings) and is added to `runtime.pendingRemoval`. Entities already flagged for
 * removal this tick (a `delete` command) are skipped: a deletion is neither a loss nor a kill.
 */
export function runDeath(ctx: SimContext): void {
  const { state, runtime } = ctx;
  for (const e of state.entities) {
    if (e.kind === 'node' || e.hp > 0 || runtime.pendingRemoval.includes(e.id)) continue;
    const killer = killerOf(ctx, e);
    if (e.kind === 'unit') {
      emit(ctx, {
        type: 'UnitDied',
        playerId: e.owner,
        unitId: e.id,
        unitType: e.typeId,
        x: e.pos.x,
        y: e.pos.y,
        facing: e.facing,
        killerPlayerId: killer,
      });
      recordStat(ctx, e.owner, (s) => void (s.unitsLost += 1));
      if (killer !== null) recordStat(ctx, killer, (s) => void (s.unitsKilled += 1));
    } else {
      emit(ctx, {
        type: 'BuildingDestroyed',
        playerId: e.owner,
        buildingId: e.id,
        buildingType: e.typeId,
        tx: e.tile.tx,
        ty: e.tile.ty,
        size: ctx.data.building(e.typeId).footprint,
        constructed: e.constructed,
        killerPlayerId: killer,
      });
      recordStat(ctx, e.owner, (s) => void (s.buildingsLost += 1));
      if (killer !== null) recordStat(ctx, killer, (s) => void (s.buildingsDestroyed += 1));
      e.queue = []; // no refund (unlike `delete`); a foundation's costPaid is lost too
    }
    insertSorted(runtime.pendingRemoval, e.id);
  }
}
