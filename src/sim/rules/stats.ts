/**
 * Stat resolution through modifiers (plan 4.7). Owned by WP8.
 *
 * value = (base + sum of matching `add`) * product of matching `mul`, where the
 * matching modifiers are the civ's bonuses followed by the effects of the
 * player's researched techs (in completion order). A modifier matches a def if
 * the def's id is in `select.ids` OR the def has one of `select.tags`.
 *
 * Stats other systems should request (`StatKey`):
 * - units: `speed`, `carryCapacity`, `gatherRate.<wood|berries|farm|gold|stone>`
 *   (only the kinds the unit can gather), `trainTime`, `popCost`, hp/attack/meleeArmor/pierceArmor/range
 * - buildings: `buildTime`, `popProvided`, `incomeRate` (only with `income`), hp, meleeArmor, pierceArmor
 *   (+ attack, range with `combat.attack`)
 * - techs: `researchTime`
 * - units, buildings and techs: `cost.food|wood|gold|stone` (integers, min 0)
 *
 * Combat stats (hp, attack, meleeArmor, pierceArmor, range) are rounded with Math.round after resolution, like costs
 * (PLAN-M2 3.5). The combat profiles (`runtime.combat`, PLAN-M2 3.5) are rebuilt together with the stat table.
 * Owned by WP20 in M2, then the orchestrator.
 */

import type { AnyDef, BuildingDef, Modifier, ProducibleDef, UnitDef } from '../../data/schema';
import {
  RESOURCE_TYPES,
  TICK_RATE,
  type DefId,
  type PlayerId,
  type ResolvedBuildingCombat,
  type ResolvedUnitCombat,
  type ResourceAmounts,
  type SimContext,
  type StatKey,
} from '../types';

type StatTable = Partial<Record<StatKey, number>>;

/** Stats rounded with Math.round after resolution (besides costs). */
const ROUNDED_COMBAT_STATS: ReadonlySet<StatKey> = new Set<StatKey>(['hp', 'attack', 'meleeArmor', 'pierceArmor', 'range']);

const BUILDING_CLASSES = ['building'] as const;

const GATHER_KINDS = ['wood', 'berries', 'farm', 'gold', 'stone'] as const;

/** Base values of every stat the def has. */
function baseStats(def: ProducibleDef): StatTable {
  const t: StatTable = {};
  if (def.kind === 'unit') {
    t.hp = def.combat.hp;
    t.attack = def.combat.attack;
    t.meleeArmor = def.combat.meleeArmor;
    t.pierceArmor = def.combat.pierceArmor;
    t.range = def.combat.range;
    t.speed = def.speed;
    t.popCost = def.popCost;
    t.trainTime = def.trainTime;
    if (def.gather !== undefined) {
      t.carryCapacity = def.gather.carryCapacity;
      for (const k of GATHER_KINDS) {
        const rate = def.gather.rates[k];
        if (rate !== undefined) t[`gatherRate.${k}`] = rate;
      }
    }
  } else if (def.kind === 'building') {
    t.hp = def.combat.hp;
    t.meleeArmor = def.combat.meleeArmor;
    t.pierceArmor = def.combat.pierceArmor;
    if (def.combat.attack !== undefined) {
      t.attack = def.combat.attack.attack;
      t.range = def.combat.attack.range;
    }
    t.buildTime = def.buildTime;
    t.popProvided = def.popProvided;
    if (def.income !== undefined) t.incomeRate = def.income.perSecond;
  } else {
    t.researchTime = def.researchTime;
  }
  for (const r of RESOURCE_TYPES) t[`cost.${r}`] = def.cost[r] ?? 0;
  return t;
}

function matches(mod: Modifier, def: AnyDef): boolean {
  if (mod.select.ids !== undefined && mod.select.ids.includes(def.id)) return true;
  const tags = mod.select.tags;
  if (tags === undefined || def.kind === 'node') return false;
  return tags.some((tag) => def.tags.includes(tag));
}

/** Modifiers in force for a player: civ bonuses, then researched techs in completion order. */
function modifiersFor(ctx: SimContext, playerId: PlayerId): Modifier[] {
  const player = ctx.state.players[playerId];
  const mods: Modifier[] = [];
  if (player === undefined) return mods;
  if (player.civ !== null) {
    for (const bonus of ctx.data.civ(player.civ).bonuses) mods.push(...bonus.modifiers);
  }
  for (const techId of player.researched) {
    const tech = ctx.data.def(techId);
    if (tech !== undefined && tech.kind === 'tech') mods.push(...tech.effects);
  }
  return mods;
}

function resolveDef(def: ProducibleDef, mods: readonly Modifier[]): StatTable {
  const base = baseStats(def);
  const own = mods.filter((m) => matches(m, def));
  const out: StatTable = {};
  for (const key of Object.keys(base) as StatKey[]) {
    let add = 0;
    let mul = 1;
    for (const m of own) {
      if (m.stat !== key) continue;
      if (m.op === 'add') add += m.value;
      else mul *= m.value;
    }
    let v = ((base[key] as number) + add) * mul;
    if (key.startsWith('cost.')) v = Math.max(0, Math.round(v));
    else if (ROUNDED_COMBAT_STATS.has(key)) v = Math.round(v);
    out[key] = v;
  }
  return out;
}

/**
 * Resolved value of `stat` for `defId` as owned by `playerId`:
 * base -> civ modifiers -> tech modifiers; all `add` before all `mul`.
 * Reads the cache in `ctx.runtime.resolvedStats`; a def missing from the cache
 * is resolved on the fly. Throws for an unknown def or a stat the def does not have.
 */
export function resolvedStat(ctx: SimContext, playerId: PlayerId, defId: DefId, stat: StatKey): number {
  const cached = ctx.runtime.resolvedStats[playerId]?.[defId]?.[stat];
  if (cached !== undefined) return cached;
  const def = ctx.data.producible(defId);
  if (def === undefined) throw new Error(`resolvedStat: unknown def ${defId}`);
  const v = resolveDef(def, modifiersFor(ctx, playerId))[stat];
  if (v === undefined) throw new Error(`resolvedStat: ${defId} has no stat ${stat}`);
  return v;
}

/** Resolved cost of a def for a player (integers). */
export function resolvedCost(ctx: SimContext, playerId: PlayerId, defId: DefId): ResourceAmounts {
  return {
    food: resolvedStat(ctx, playerId, defId, 'cost.food'),
    wood: resolvedStat(ctx, playerId, defId, 'cost.wood'),
    gold: resolvedStat(ctx, playerId, defId, 'cost.gold'),
    stone: resolvedStat(ctx, playerId, defId, 'cost.stone'),
  };
}

/** Combat profile of a unit def from its resolved stat table (PLAN-M2 3.5). */
export function resolveUnitCombat(ctx: SimContext, def: UnitDef, stats: StatTable): ResolvedUnitCombat {
  const c = def.combat;
  const range = stats.range ?? c.range;
  const windupTicks = Math.max(1, Math.round(c.windup * TICK_RATE));
  return {
    kind: 'unit',
    maxHp: stats.hp ?? c.hp,
    attack: stats.attack ?? c.attack,
    attackType: c.attackType,
    meleeArmor: stats.meleeArmor ?? c.meleeArmor,
    pierceArmor: stats.pierceArmor ?? c.pierceArmor,
    range,
    minRange: c.minRange,
    reach: range + ctx.data.combat.reach,
    windupTicks,
    cooldownTicks: Math.max(windupTicks + 1, Math.round(c.cooldown * TICK_RATE)),
    sight: c.sight,
    classes: c.classes,
    bonus: c.bonus,
    bonusResist: c.bonusResist,
    projectile: c.projectile,
    splash: c.splash,
    targets: c.targets,
    autoAcquire: c.autoAcquire,
  };
}

/** Combat profile of a building def from its resolved stat table (PLAN-M2 3.5). */
export function resolveBuildingCombat(ctx: SimContext, def: BuildingDef, stats: StatTable): ResolvedBuildingCombat {
  const c = def.combat;
  const a = c.attack;
  const range = a === undefined ? 0 : (stats.range ?? a.range);
  return {
    kind: 'building',
    maxHp: stats.hp ?? c.hp,
    meleeArmor: stats.meleeArmor ?? c.meleeArmor,
    pierceArmor: stats.pierceArmor ?? c.pierceArmor,
    bonusResist: 0,
    classes: BUILDING_CLASSES,
    attack:
      a === undefined
        ? null
        : {
            attack: stats.attack ?? a.attack,
            attackType: a.attackType,
            range,
            reach: range + ctx.data.combat.reach,
            cooldownTicks: Math.max(1, Math.round(a.cooldown * TICK_RATE)),
            arrows: a.arrows,
            projectile: a.projectile,
          },
  };
}

/** Rebuild the resolved-stat cache (and the combat profiles) for one player. */
export function rebuildResolvedStats(ctx: SimContext, playerId: PlayerId): void {
  const mods = modifiersFor(ctx, playerId);
  const table: Record<DefId, StatTable> = {};
  const combat: Record<DefId, ResolvedUnitCombat | ResolvedBuildingCombat> = {};
  for (const def of ctx.data.units) {
    const t = resolveDef(def, mods);
    table[def.id] = t;
    combat[def.id] = resolveUnitCombat(ctx, def, t);
  }
  for (const def of ctx.data.buildings) {
    const t = resolveDef(def, mods);
    table[def.id] = t;
    combat[def.id] = resolveBuildingCombat(ctx, def, t);
  }
  for (const def of ctx.data.techs) table[def.id] = resolveDef(def, mods);
  ctx.runtime.resolvedStats[playerId] = table;
  ctx.runtime.combat[playerId] = combat;
}

/** Resolved stat table of a def for a player, from the cache or computed on the fly (not cached). */
export function resolvedStatTable(ctx: SimContext, playerId: PlayerId, def: ProducibleDef): StatTable {
  return ctx.runtime.resolvedStats[playerId]?.[def.id] ?? resolveDef(def, modifiersFor(ctx, playerId));
}

/** Rebuild the resolved-stat cache for every player. */
export function rebuildAllResolvedStats(ctx: SimContext): void {
  for (const player of ctx.state.players) rebuildResolvedStats(ctx, player.id);
}
