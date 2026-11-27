/**
 * Unit power estimate (PLAN-M2 6.1): `hp * attack * TICK_RATE / cooldownTicks`, from resolved stats (techs count),
 * so it is the damage a unit can deal over a lifetime of its current hp, in "hp-attack per second". Only a
 * comparison measure: the AI compares wave power with its start power and threat power with defender power.
 */

import type { DataRegistry } from '../../data';
import { TICK_RATE, type PlayerId, type SimQuery, type UnitId } from '../../sim';

/** Resolved attack per second of one unit type for one player, cached for one decision. */
export class PowerTable {
  private readonly cache: Record<string, number> = {};

  constructor(
    private readonly query: SimQuery,
    private readonly data: DataRegistry,
  ) {}

  /** Attack * TICK_RATE / cooldownTicks for (owner, type); 0 for units that cannot fight units (siege). */
  rate(owner: PlayerId, typeId: UnitId): number {
    const key = `${owner}:${typeId}`;
    const hit = this.cache[key];
    if (hit !== undefined) return hit;
    const def = this.data.unit(typeId);
    const c = def.combat;
    let value = 0;
    if (c.targets === 'any') {
      const windupTicks = Math.max(1, Math.round(c.windup * TICK_RATE));
      const cooldownTicks = Math.max(windupTicks + 1, Math.round(c.cooldown * TICK_RATE));
      let attack = c.attack;
      try {
        attack = this.query.resolvedStat(owner, typeId, 'attack');
      } catch {
        // Stat missing for this def: keep the base value.
      }
      value = (attack * TICK_RATE) / cooldownTicks;
    }
    this.cache[key] = value;
    return value;
  }

  /** Power of one unit at `hp`. */
  power(owner: PlayerId, typeId: UnitId, hp: number): number {
    return hp * this.rate(owner, typeId);
  }
}
