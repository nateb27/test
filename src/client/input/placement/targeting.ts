/**
 * Who can attack or repair what, and the commands the attack-move and repair
 * modes issue (PLAN-M2 7.1). Pure functions over entities and the registry.
 */

import type { DataRegistry, UnitDef } from '../../../data/schema';
import type { CommandInput, EntityId, PlayerId, ReadonlyEntity, Vec2 } from '../../../sim/types';
import { entityCentre } from '../selection';

export function unitDefOf(e: ReadonlyEntity, registry: DataRegistry): UnitDef | null {
  const d = e.kind === 'unit' ? registry.def(e.typeId) : undefined;
  return d !== undefined && d.kind === 'unit' ? d : null;
}

/** A unit or building of another real player (nodes and neutral things are not enemies). */
export function isEnemyOf(target: ReadonlyEntity | null | undefined, owner: PlayerId): target is ReadonlyEntity {
  return target !== null && target !== undefined && target.kind !== 'node' && target.owner !== 0 && target.owner !== owner;
}

/** Whether a unit def can attack at all (every M2 unit, villagers included, has attack > 0). */
export function canAttack(def: UnitDef): boolean {
  return def.combat.attack > 0;
}

/** Whether a unit def may target `target` (rams hit buildings only). */
export function canTarget(def: UnitDef, target: ReadonlyEntity): boolean {
  return canAttack(def) && (def.combat.targets === 'any' || target.kind === 'building');
}

function ids(list: readonly ReadonlyEntity[]): EntityId[] {
  return list.map((e) => e.id).sort((a, b) => a - b);
}

/** Own units among `selected` that can attack. */
export function attackers(selected: readonly ReadonlyEntity[], owner: PlayerId, registry: DataRegistry): ReadonlyEntity[] {
  return selected.filter((e) => {
    if (e.owner !== owner) return false;
    const d = unitDefOf(e, registry);
    return d !== null && canAttack(d);
  });
}

/** Whether any selected own unit can target `target`: the sword cursor condition. */
export function anySelectedCanTarget(selected: readonly ReadonlyEntity[], target: ReadonlyEntity, owner: PlayerId, registry: DataRegistry): boolean {
  if (!isEnemyOf(target, owner)) return false;
  for (const e of selected) {
    if (e.owner !== owner) continue;
    const d = unitDefOf(e, registry);
    if (d !== null && canTarget(d, target)) return true;
  }
  return false;
}

export interface AttackMoveInput {
  selected: readonly ReadonlyEntity[];
  /** Entity under the click, or null. */
  target: ReadonlyEntity | null;
  /** The clicked ground point, clamped to the map. */
  point: Vec2;
  shift: boolean;
  owner: PlayerId;
  registry: DataRegistry;
}

/**
 * Left click in attack-move mode: an enemy under the cursor is attacked by the units that can target it (the rest
 * attack-move to it); anything else is an `attackMove` to the point. Shift queues.
 */
export function resolveAttackMoveCommands(input: AttackMoveInput): CommandInput[] {
  const { target, point, shift, owner, registry } = input;
  const units = attackers(input.selected, owner, registry);
  if (units.length === 0) return [];
  if (!isEnemyOf(target, owner)) {
    return [{ type: 'attackMove', unitIds: ids(units), x: point.x, y: point.y, queue: shift }];
  }
  const hitters = units.filter((u) => {
    const d = unitDefOf(u, registry);
    return d !== null && canTarget(d, target);
  });
  const rest = units.filter((u) => !hitters.includes(u));
  const out: CommandInput[] = [];
  if (hitters.length > 0) out.push({ type: 'attack', unitIds: ids(hitters), targetId: target.id, queue: shift });
  if (rest.length > 0) {
    const c = entityCentre(target, registry);
    out.push({ type: 'attackMove', unitIds: ids(rest), x: c.x, y: c.y, queue: shift });
  }
  return out;
}

/** An own, completed building that is below its max hp. */
export function isDamagedOwnBuilding(target: ReadonlyEntity | null, owner: PlayerId, maxHp: (e: ReadonlyEntity) => number): boolean {
  return target !== null && target.kind === 'building' && target.owner === owner && target.constructed && target.hp < maxHp(target);
}

/** Selected own units whose def can build `target`'s type, ascending ids. */
export function repairers(selected: readonly ReadonlyEntity[], target: ReadonlyEntity, owner: PlayerId, registry: DataRegistry): EntityId[] {
  const out: ReadonlyEntity[] = [];
  for (const e of selected) {
    if (e.owner !== owner) continue;
    const d = unitDefOf(e, registry);
    if (d !== null && d.builds !== undefined && d.builds.includes(target.typeId)) out.push(e);
  }
  return ids(out);
}
