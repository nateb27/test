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
 *   (only the kinds the unit can gather), `trainTime`, `popCost`, hp/attack/armor/range
 * - buildings: `buildTime`, `popProvided`, `incomeRate` (only with `income`), hp, armor
 * - techs: `researchTime`
 * - units, buildings and techs: `cost.food|wood|gold|stone` (integers, min 0)
 */

import type { AnyDef, Modifier, ProducibleDef } from '../../data/schema';
import {
  RESOURCE_TYPES,
  type DefId,
  type PlayerId,
  type ResourceAmounts,
  type SimContext,
  type StatKey,
} from '../types';

type StatTable = Partial<Record<StatKey, number>>;

const GATHER_KINDS = ['wood', 'berries', 'farm', 'gold', 'stone'] as const;

/** Base values of every stat the def has. */
function baseStats(def: ProducibleDef): StatTable {
  const t: StatTable = {};
  if (def.kind === 'unit') {
    t.hp = def.combat.hp;
    t.attack = def.combat.attack;
    t.armor = def.combat.armor;
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
    t.armor = def.combat.armor;
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

/** Rebuild the resolved-stat cache for one player. */
export function rebuildResolvedStats(ctx: SimContext, playerId: PlayerId): void {
  const mods = modifiersFor(ctx, playerId);
  const table: Record<DefId, StatTable> = {};
  for (const def of ctx.data.units) table[def.id] = resolveDef(def, mods);
  for (const def of ctx.data.buildings) table[def.id] = resolveDef(def, mods);
  for (const def of ctx.data.techs) table[def.id] = resolveDef(def, mods);
  ctx.runtime.resolvedStats[playerId] = table;
}

/** Rebuild the resolved-stat cache for every player. */
export function rebuildAllResolvedStats(ctx: SimContext): void {
  for (const player of ctx.state.players) rebuildResolvedStats(ctx, player.id);
}
