/**
 * Paper model of the PLAN-M2 section 5 numbers (WP25). It applies the real damage formula (4.1) and the attack timing
 * of 4.3 to a stripped-down one-dimensional fight: every unit of a group stands at one point, melee units close at
 * their speed, ranged units stand and shoot, projectiles fly at the 4.4 speeds, units die at the end of the tick (so
 * simultaneous kills are possible) and each unit hits the nearest enemy it may target (ties: lowest index). There is no
 * crowding and no kiting, so it is optimistic for big melee groups and exact for the 1v1 numbers. `docs/BALANCE.md`
 * quotes its output; the real-sim duels in `tests/sim/duels.test.ts` are the ground truth once combat is integrated.
 */

import { registry } from '../../../src/data';
import type { BuildingDef } from '../../../src/data/schema';
import type { ResolvedUnitCombat, SimContext } from '../../../src/sim/types';
import { TICK_RATE } from '../../../src/sim/types';
import { resolveUnitCombat } from '../../../src/sim/rules/stats';
import { computeDamage } from '../../../src/sim/systems/combat/damage';

const R = registry;
const ctxForResolve = { data: R } as unknown as SimContext;

/** Combat profile of a unit def at base stats (no techs). */
export function baseProfile(id: string): ResolvedUnitCombat {
  return resolveUnitCombat(ctxForResolve, R.unit(id), {});
}

export function costTotal(id: string): number {
  const c = R.unit(id).cost;
  return (c.food ?? 0) + (c.wood ?? 0) + (c.gold ?? 0) + (c.stone ?? 0);
}

/** Damage one hit of `att` deals to unit `def` (4.1). */
export function hit(att: ResolvedUnitCombat, def: ResolvedUnitCombat): number {
  return computeDamage(att, def, R.combat.minDamage);
}

/** Damage per second of `att` against `def` (hit / cooldown). */
export function dps(att: ResolvedUnitCombat, def: ResolvedUnitCombat): number {
  return hit(att, def) / (att.cooldownTicks / TICK_RATE);
}

/** Seconds one `att` needs to kill one fresh `def` (first blow lands after the wind-up; the rest every cooldown). */
export function timeToKill(att: ResolvedUnitCombat, def: ResolvedUnitCombat): number {
  const hits = Math.ceil(def.maxHp / hit(att, def));
  return (att.windupTicks + (hits - 1) * att.cooldownTicks) / TICK_RATE;
}

/** Hits-to-kill and time-to-kill against a building (4.1; buildings have `bonusResist` 0). */
export function timeToKillBuilding(att: ResolvedUnitCombat, b: BuildingDef): number {
  const def = { meleeArmor: b.combat.meleeArmor, pierceArmor: b.combat.pierceArmor, classes: ['building' as const], bonusResist: 0 };
  const dmg = computeDamage(att, def, R.combat.minDamage);
  const hits = Math.ceil(b.combat.hp / dmg);
  return (att.windupTicks + (hits - 1) * att.cooldownTicks) / TICK_RATE;
}

export interface DuelSide {
  /** [unit id, count] groups. */
  units: [string, number][];
  /** Optional per-unit-id profile override (upgrades). */
  profiles?: Record<string, ResolvedUnitCombat>;
}

export interface DuelOutcome {
  winner: 'a' | 'b' | 'none';
  /** Seconds until one side has no unit that can still be hurt by the other (or the cap). */
  seconds: number;
  /** Cost of the surviving units over the starting cost, per side. */
  survivingA: number;
  survivingB: number;
  hpLeftA: number;
  hpLeftB: number;
}

interface M {
  side: 'a' | 'b';
  id: string;
  p: ResolvedUnitCombat;
  hp: number;
  x: number;
  cool: number;
  wind: number;
  swing: number; // index of the swing target
  speed: number;
}

/** Victims a group works on at a time (the front rank). */
const FRONT = 4;
const FLIGHT: Record<string, number> = { arrow: R.combat.projectileSpeed.arrow, stone: R.combat.projectileSpeed.stone, fire: R.combat.projectileSpeed.fire };

/** Equal-cost group: the count of `id` whose total is nearest to `budget`, at least 1. */
export function countFor(id: string, budget: number): number {
  return Math.max(1, Math.round(budget / costTotal(id)));
}

/** Run one fight. `distance` is the gap in tiles at the start. Cap 120 s. */
export function duel(a: DuelSide, b: DuelSide, distance = 10): DuelOutcome {
  const all: M[] = [];
  const make = (side: 'a' | 'b', s: DuelSide) => {
    for (const [id, n] of s.units) {
      const p = s.profiles?.[id] ?? baseProfile(id);
      for (let i = 0; i < n; i += 1) {
        all.push({ side, id, p, hp: p.maxHp, x: side === 'a' ? 0 : distance, cool: 0, wind: 0, swing: -1, speed: R.unit(id).speed / TICK_RATE });
      }
    }
  };
  make('a', a);
  make('b', b);
  const startCost = { a: 0, b: 0 };
  for (const m of all) startCost[m.side] += costTotal(m.id);
  const flying: { left: number; target: number; dmg: number; splash: ResolvedUnitCombat['splash']; side: 'a' | 'b'; from: ResolvedUnitCombat }[] = [];
  const alive = (m: M) => m.hp > 0;
  const canHurt = (att: M, def: M) => alive(def) && def.side !== att.side && att.p.targets === 'any';
  let tick = 0;
  const cap = 120 * TICK_RATE;
  for (; tick < cap; tick += 1) {
    const aLive = all.some((m) => m.side === 'a' && alive(m) && all.some((o) => canHurt(m, o)));
    const bLive = all.some((m) => m.side === 'b' && alive(m) && all.some((o) => canHurt(m, o)));
    if (!aLive || !bLive) break;
    // 8a: attacks and movement (movement first in the real tick order, attacks after).
    const pending: { m: M; t: number }[] = [];
    for (const m of all) {
      if (!alive(m)) continue;
      // nearest target
      let best = -1;
      let bestD = Infinity;
      for (let j = 0; j < all.length; j += 1) {
        const o = all[j]!;
        if (!canHurt(m, o)) continue;
        const d = Math.abs(o.x - m.x);
        if (d < bestD) { bestD = d; best = j; }
      }
      // A real group is spread over a few tiles, so attackers do not all pick the same victim, but they do not spread
      // evenly either (the front rank is hit first). The model has one coordinate, so every enemy of a group is
      // "equally near": attackers share the first FRONT candidates by attacker index.
      if (best >= 0) {
        const tied: number[] = [];
        for (let j = 0; j < all.length; j += 1) {
          if (canHurt(m, all[j]!) && Math.abs(Math.abs(all[j]!.x - m.x) - bestD) < 0.3) tied.push(j);
        }
        best = tied[all.indexOf(m) % Math.min(FRONT, tied.length)]!;
      }
      const inReach = best >= 0 && bestD <= m.p.reach + 1e-6 && (m.p.minRange === 0 || bestD >= m.p.minRange);
      if (m.wind === 0 && best >= 0 && !inReach && bestD > m.p.reach + 1e-6) {
        m.x += Math.min(m.speed, bestD - m.p.reach) * (all[best]!.x > m.x ? 1 : -1);
      }
      if (m.cool > 0) m.cool -= 1;
      if (m.wind > 0) {
        m.wind -= 1;
        if (m.wind === 0) {
          pending.push({ m, t: m.swing });
          m.cool = m.p.cooldownTicks - m.p.windupTicks;
        }
      } else if (m.cool === 0 && inReach) {
        m.wind = m.p.windupTicks;
        m.swing = best;
        // a started wind-up counts down from the next tick, matching 4.3 (start on tick T releases on T + windupTicks)
      }
    }
    for (const { m, t } of pending) {
      const o = all[t]!;
      if (!alive(o) && m.p.projectile === null) continue;
      if (m.p.projectile === null) {
        if (Math.abs(o.x - m.x) <= m.p.reach + R.combat.meleeReleaseSlack) o.hp = Math.max(0, o.hp - hit(m.p, o.p));
      } else {
        const dist = Math.abs(o.x - m.x);
        const ft = Math.max(1, Math.ceil((dist * TICK_RATE) / FLIGHT[m.p.projectile]!));
        flying.push({ left: ft, target: t, dmg: hit(m.p, o.p), splash: m.p.splash, side: m.side, from: m.p });
      }
    }
    for (let i = flying.length - 1; i >= 0; i -= 1) {
      const f = flying[i]!;
      f.left -= 1;
      if (f.left > 0) continue;
      flying.splice(i, 1);
      const o = all[f.target]!;
      if (alive(o)) o.hp = Math.max(0, o.hp - f.dmg);
      if (f.splash !== null) {
        for (const s of all) {
          if (s === o || !alive(s) || s.side === f.side || Math.abs(s.x - o.x) > f.splash.radius) continue;
          s.hp = Math.max(0, s.hp - Math.max(1, Math.floor((hit(f.from, s.p) * f.splash.percent) / 100)));
        }
      }
    }
  }
  const surv = { a: 0, b: 0 };
  const hpLeft = { a: 0, b: 0 };
  for (const m of all) {
    if (alive(m)) {
      surv[m.side] += costTotal(m.id);
      hpLeft[m.side] += m.hp;
    }
  }
  const aAlive = all.some((m) => m.side === 'a' && alive(m));
  const bAlive = all.some((m) => m.side === 'b' && alive(m));
  const aCan = all.some((m) => m.side === 'a' && alive(m) && all.some((o) => canHurt(m, o)));
  const bCan = all.some((m) => m.side === 'b' && alive(m) && all.some((o) => canHurt(m, o)));
  let winner: DuelOutcome['winner'] = 'none';
  if (aCan && !bCan) winner = 'a';
  else if (bCan && !aCan) winner = 'b';
  else if (!aCan && !bCan) winner = aAlive && !bAlive ? 'a' : bAlive && !aAlive ? 'b' : 'none';
  return {
    winner,
    seconds: tick / TICK_RATE,
    survivingA: startCost.a === 0 ? 0 : surv.a / startCost.a,
    survivingB: startCost.b === 0 ? 0 : surv.b / startCost.b,
    hpLeftA: hpLeft.a,
    hpLeftB: hpLeft.b,
  };
}

/** Matrix letter of the row side (`a`) against the column side: W (wins with >= 30% cost left), w, L or '='. */
export function letter(o: DuelOutcome): 'W' | 'w' | 'L' | '=' {
  if (o.winner === 'b') return 'L';
  if (o.winner === 'a') return o.survivingA >= 0.3 ? 'W' : 'w';
  return '=';
}

/** Equal-cost duel of one unit type against another with a budget. */
export function equalCost(rowId: string, colId: string, budget = 1200): DuelOutcome {
  return duel({ units: [[rowId, countFor(rowId, budget)]] }, { units: [[colId, countFor(colId, budget)]] });
}

/** Damage of one blow of `att` against building `b` (4.1; buildings have class `building` and `bonusResist` 0). */
export function hitBuilding(att: ResolvedUnitCombat, b: BuildingDef): number {
  return computeDamage(att, { meleeArmor: b.combat.meleeArmor, pierceArmor: b.combat.pierceArmor, classes: ['building'], bonusResist: 0 }, R.combat.minDamage);
}

/**
 * Seconds for `n` units of `unitId` to destroy building `buildingId`, starting `gap` tiles from the footprint edge.
 * They walk until in reach, then every unit swings in step (the first blow after the wind-up, then every cooldown),
 * sharing the blows evenly; crowding around a footprint is ignored (3x3 and 4x4 footprints have room for 12 to 16).
 */
export function buildingKillSeconds(unitId: string, n: number, buildingId: string, gap: number, overrides: Partial<BuildingDef['combat']> = {}): number {
  const att = baseProfile(unitId);
  const b = R.building(buildingId);
  const target = { ...b, combat: { ...b.combat, ...overrides } };
  const hits = Math.ceil(target.combat.hp / hitBuilding(att, target));
  const perUnit = Math.ceil(hits / n);
  const walk = Math.max(0, gap - att.reach) / R.unit(unitId).speed;
  return walk + (att.windupTicks + (perUnit - 1) * att.cooldownTicks) / TICK_RATE;
}

/**
 * Damage per second of `n` units of `unitId` against a stand-ground clump of `victim`s, where each blow's primary
 * target has `neighbours` other victims inside the splash radius (splash damage is `max(1, floor(hit * percent / 100))`).
 */
export function clumpDps(unitId: string, n: number, victimId: string, neighbours: number): number {
  const att = baseProfile(unitId);
  const victim = baseProfile(victimId);
  const primary = hit(att, victim);
  const splash = att.splash === null ? 0 : Math.max(1, Math.floor((primary * att.splash.percent) / 100)) * neighbours;
  return (n * (primary + splash)) / (att.cooldownTicks / TICK_RATE);
}
