/**
 * Can this group take that target, and what will it cost? The AI's estimate of a fight against a building (or a group
 * of villagers) under the arrows of defensive buildings (Town Centers), from resolved stats and the 4.1 damage formula.
 *
 * Model (`strike`): the attackers deal their summed damage per second to the target (minus what its repairers restore);
 * every covering tower shoots one attacker at a time, fighting units first (its 4.10 tier 1), then the rest (siege),
 * each in ascending id, so a unit survives until the tower has killed every unit before it. This is Lanchester's
 * linear law with a stationary shooter: a group that cannot finish the target before the arrows thin it out does not
 * go in. It is a decision aid only (the AI never writes state); walking time and overkill are ignored.
 */

import { TICK_RATE, type BuildingId, type PlayerId, type UnitId } from '../../sim';
import type { AiDecision } from './context';
import { distSqTo, type BuildingInfo, type UnitInfo } from './world';

/** A building with an attack (a Town Center): what it reaches (centre distance, +1 tile margin) and what it fires. */
export interface Tower {
  b: BuildingInfo;
  /** Reach from the footprint centre plus one tile of margin (arrows are aimed from the centre, 4.10). */
  reach: number;
  arrows: number;
  attack: number;
  /** Seconds between volleys. */
  period: number;
}

export interface StrikeResult {
  /** Seconds until the target falls, or null if the group dies (or deals no damage) first. */
  seconds: number | null;
  /** Attackers the towers kill before the target falls (all of them when it does not). */
  lost: number;
}

/** Per-decision cache of resolved combat numbers (owner and def id keyed). */
export class CombatTable {
  private readonly cache: Record<string, number> = {};

  constructor(private readonly d: AiDecision) {}

  private stat(owner: PlayerId, id: string, stat: 'attack' | 'meleeArmor' | 'pierceArmor' | 'buildTime', base: number): number {
    const key = `${owner}:${id}:${stat}`;
    const hit = this.cache[key];
    if (hit !== undefined) return hit;
    let v = base;
    try {
      v = this.d.query.resolvedStat(owner, id, stat);
    } catch {
      // keep the base value
    }
    this.cache[key] = v;
    return v;
  }

  /** Seconds between blows of a unit type (4.3: cooldown ticks, at least wind-up + 1). */
  period(typeId: UnitId): number {
    const c = this.d.data.unit(typeId).combat;
    const windupTicks = Math.max(1, Math.round(c.windup * TICK_RATE));
    return Math.max(windupTicks + 1, Math.round(c.cooldown * TICK_RATE)) / TICK_RATE;
  }

  /** Damage of one blow of `u` against a building (4.1; buildings have the `building` class and no resist). */
  blowVsBuilding(u: UnitInfo, b: BuildingInfo): number {
    const c = this.d.data.unit(u.typeId).combat;
    const bc = this.d.data.building(b.typeId).combat;
    const attack = this.stat(u.owner, u.typeId, 'attack', c.attack);
    const armor = c.attackType === 'melee' ? this.stat(b.owner, b.typeId, 'meleeArmor', bc.meleeArmor) : this.stat(b.owner, b.typeId, 'pierceArmor', bc.pierceArmor);
    return Math.max(this.d.data.combat.minDamage, attack - armor) + (c.bonus.building ?? 0);
  }

  /** Damage per second of `u` against a building (0 for units that cannot attack). */
  dpsVsBuilding(u: UnitInfo, b: BuildingInfo): number {
    if (this.d.data.unit(u.typeId).combat.attack <= 0) return 0;
    return this.blowVsBuilding(u, b) / this.period(u.typeId);
  }

  /** Damage per second of `u` against an enemy unit of type `t` (4.1, with bonus and resist). Siege: 0. */
  dpsVsUnit(u: UnitInfo, t: UnitInfo): number {
    const c = this.d.data.unit(u.typeId).combat;
    if (c.targets !== 'any' || c.attack <= 0) return 0;
    const tc = this.d.data.unit(t.typeId).combat;
    const attack = this.stat(u.owner, u.typeId, 'attack', c.attack);
    const armor = c.attackType === 'melee' ? this.stat(t.owner, t.typeId, 'meleeArmor', tc.meleeArmor) : this.stat(t.owner, t.typeId, 'pierceArmor', tc.pierceArmor);
    let bonus = 0;
    for (const cls of tc.classes) bonus += c.bonus[cls] ?? 0;
    bonus = Math.floor((bonus * (100 - tc.bonusResist)) / 100);
    return (Math.max(this.d.data.combat.minDamage, attack - armor) + bonus) / this.period(u.typeId);
  }

  /** Damage per second a tower deals to `u` (all its arrows at it). */
  towerDps(t: Tower, u: UnitInfo): number {
    const pa = this.stat(u.owner, u.typeId, 'pierceArmor', this.d.data.unit(u.typeId).combat.pierceArmor);
    return (t.arrows * Math.max(this.d.data.combat.minDamage, t.attack - pa)) / t.period;
  }

  /** Hit points per second the repairers of a building restore (4.12 rate; 0 without repairers). */
  repairRate(b: BuildingInfo): number {
    if (b.repairers <= 0 || !b.constructed) return 0;
    const rules = this.d.data.combat;
    const buildTime = this.stat(b.owner, b.typeId, 'buildTime', this.d.data.building(b.typeId).buildTime);
    const base = Math.max(rules.repairMinHpPerSecond, (rules.repairRateFactor * b.maxHp) / Math.max(1, buildTime));
    return base * (1 + 0.5 * (b.repairers - 1));
  }
}

/** Every constructed enemy building with an attack (the Town Centers). */
export function enemyTowers(d: AiDecision): Tower[] {
  const towers: Tower[] = [];
  for (const b of d.world.enemyBuildings) {
    d.ops.n++;
    const a = d.data.building(b.typeId as BuildingId).combat.attack;
    if (a === undefined || !b.constructed) continue;
    let attack = a.attack;
    let range = a.range;
    try {
      attack = d.query.resolvedStat(b.owner, b.typeId, 'attack');
      range = d.query.resolvedStat(b.owner, b.typeId, 'range');
    } catch {
      // keep the base values
    }
    towers.push({ b, reach: range + d.data.combat.reach + 1, arrows: a.arrows, attack, period: Math.max(1, Math.round(a.cooldown * TICK_RATE)) / TICK_RATE });
  }
  return towers;
}

/** Towers (other than `except`) whose reach covers the building `t`, or the point (x, y) when `t` is null. */
export function coveringTowers(towers: readonly Tower[], x: number, y: number, t: BuildingInfo | null, except: BuildingInfo | null = null): Tower[] {
  const out: Tower[] = [];
  for (const tw of towers) {
    if (except !== null && tw.b.id === except.id) continue;
    const dd = t !== null ? distSqTo(tw.b.cx, tw.b.cy, t) : (tw.b.cx - x) * (tw.b.cx - x) + (tw.b.cy - y) * (tw.b.cy - y);
    if (dd <= tw.reach * tw.reach) out.push(tw);
  }
  return out;
}

/**
 * The fight model above. `dps(u)` is what attacker `u` deals to the target per second; `hp` is the damage needed
 * (target hp, times a safety margin); `heal` is what the defender restores per second.
 */
export function strike(
  d: AiDecision,
  table: CombatTable,
  attackers: readonly UnitInfo[],
  hp: number,
  dps: (u: UnitInfo) => number,
  towers: readonly Tower[],
  heal = 0,
): StrikeResult {
  // Kill order of the towers: fighting units first, then the rest; ascending id within each tier.
  const order = [...attackers].sort((a, b) => Number(b.fighting) - Number(a.fighting) || a.id - b.id);
  const rates = order.map((u) => {
    d.ops.n++;
    return dps(u);
  });
  let total = -heal;
  for (const r of rates) total += r;
  let left = hp;
  let t = 0;
  if (towers.length === 0) return total > 0 ? { seconds: left / total, lost: 0 } : { seconds: null, lost: 0 };
  for (let k = 0; k < order.length; k++) {
    if (total <= 0) return { seconds: null, lost: order.length };
    const u = order[k]!;
    let fire = 0;
    for (const tw of towers) fire += table.towerDps(tw, u);
    const life = fire > 0 ? u.hp / fire : Infinity;
    if (total * life >= left) return { seconds: t + left / total, lost: k };
    left -= total * life;
    t += life;
    total -= rates[k]!;
  }
  return { seconds: null, lost: order.length };
}
