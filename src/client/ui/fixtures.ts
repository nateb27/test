/**
 * Fixture game states and a fake `availability` for HUD tests and the HUD dev
 * page. The real sim rules (WP6-8) were stubs while the HUD was built, so
 * everything here is derived from the data and the plan's rules (age,
 * required buildings and techs, civ restriction, `replaces`, build limits,
 * already researched, age-advance building count) instead of the sim.
 */

import { registry as defaultRegistry } from '../../data';
import type { DataRegistry, ProducibleDef } from '../../data/schema';
import { createBuilding, createNode, createUnit } from '../../sim/entities';
import { createInitialState } from '../../sim/sim';
import {
  RESOURCE_TYPES,
  type AgeNumber,
  type Availability,
  type BuildingEntity,
  type EntityId,
  type GameState,
  type PlayerId,
  type ProducibleId,
  type ResourceAmounts,
  type StatKey,
  type UnavailableReason,
} from '../../sim/types';
import type { HudQueries } from './commandCard';

export const FIXTURE_PLAYER: PlayerId = 1;

export interface FixtureOptions {
  age?: AgeNumber;
  resources?: Partial<ResourceAmounts>;
  researched?: string[];
  popUsed?: number;
  popCap?: number;
}

export interface Fixture {
  state: GameState;
  /** Own idle villagers (the second one carries wood). */
  villagers: EntityId[];
  spearman: EntityId;
  townCenter: EntityId;
  house: EntityId;
  mill: EntityId;
  /** An own Barracks under construction. */
  foundation: EntityId;
  tree: EntityId;
  enemyUnit: EntityId;
}

/** A small hand-built state: no map generation, a few of each entity kind. */
export function createFixture(opts: FixtureOptions = {}, data: DataRegistry = defaultRegistry): Fixture {
  const state = createInitialState({ seed: 7, mapSize: 40, players: [{ civ: 'byzantines' }, { civ: 'byzantines' }] }, data);
  const player = state.players[FIXTURE_PLAYER] as GameState['players'][number];
  player.age = opts.age ?? 1;
  player.resources = { food: 300, wood: 300, gold: 100, stone: 50, ...opts.resources };
  player.researched = [...(opts.researched ?? [])];
  const tc = createBuilding(state, 'townCenter', FIXTURE_PLAYER, 10, 10, true);
  const house = createBuilding(state, 'house', FIXTURE_PLAYER, 16, 10, true);
  const mill = createBuilding(state, 'mill', FIXTURE_PLAYER, 16, 14, true);
  const foundation = createBuilding(state, 'barracks', FIXTURE_PLAYER, 10, 16, false, { food: 0, wood: 120, gold: 0, stone: 0 });
  foundation.progress = 0.45;
  const v1 = createUnit(state, 'villager', FIXTURE_PLAYER, 14.5, 12.5);
  const v2 = createUnit(state, 'villager', FIXTURE_PLAYER, 15.5, 12.5);
  v2.carried = { type: 'wood', amount: 7 };
  const v3 = createUnit(state, 'villager', FIXTURE_PLAYER, 14.5, 13.5);
  v3.currentOrder = { type: 'move', x: 20, y: 20, phase: 'walking' };
  const spearman = createUnit(state, 'spearman', FIXTURE_PLAYER, 13.5, 14.5);
  const tree = createNode(state, 'tree', 22, 22, 80);
  const enemy = createUnit(state, 'spearman', 2, 30.5, 30.5);
  const popUsed = opts.popUsed ?? 4;
  player.popUsed = popUsed;
  player.popCap = opts.popCap ?? 20;
  return {
    state,
    villagers: [v1.id, v2.id, v3.id],
    spearman: spearman.id,
    townCenter: tc.id,
    house: house.id,
    mill: mill.id,
    foundation: foundation.id,
    tree: tree.id,
    enemyUnit: enemy.id,
  };
}

/** Put items into a building's production queue (progress as ticks done / total). */
export function enqueue(
  building: BuildingEntity,
  items: { kind: 'unit' | 'tech'; id: string; ticksDone: number; ticksTotal: number; popCapNotified?: boolean }[],
): void {
  const zero = { food: 0, wood: 0, gold: 0, stone: 0 };
  for (const it of items) {
    building.queue.push(
      it.kind === 'unit'
        ? { kind: 'unit', unitType: it.id, costPaid: zero, ticksDone: it.ticksDone, ticksTotal: it.ticksTotal, popCapNotified: it.popCapNotified ?? false }
        : { kind: 'tech', techId: it.id, costPaid: zero, ticksDone: it.ticksDone, ticksTotal: it.ticksTotal },
    );
  }
}

/** Resolved (civ-adjusted) cost used by the fake: Themata makes farms 20% cheaper for the Byzantines. */
function fakeCost(def: ProducibleDef, civ: string | null): ResourceAmounts {
  const cost = { food: def.cost.food ?? 0, wood: def.cost.wood ?? 0, gold: def.cost.gold ?? 0, stone: def.cost.stone ?? 0 };
  if (def.id === 'farm' && civ === 'byzantines') cost.wood = Math.round(cost.wood * 0.8);
  return cost;
}

/**
 * An `availability` that follows the plan's rules, reading the state and data.
 * Not the sim's implementation: WP8 owns that.
 */
export function fakeAvailability(state: Pick<GameState, 'players' | 'entities'>, data: DataRegistry = defaultRegistry): HudQueries['availability'] {
  return (playerId, defId: ProducibleId): Availability => {
    const player = state.players[playerId];
    const def = data.producible(defId);
    const zero = { food: 0, wood: 0, gold: 0, stone: 0 };
    if (player === undefined || def === undefined) {
      return { available: false, hidden: true, reasons: [], cost: zero, affordable: true, shortfall: zero };
    }
    const civ = player.civ;
    const wrongCiv = def.civs !== undefined && (civ === null || !def.civs.includes(civ));
    const replaced = [...data.units, ...data.buildings, ...data.techs].some(
      (other) => other.replaces === defId && civ !== null && (other.civs === undefined || other.civs.includes(civ)),
    );
    const cost = fakeCost(def, civ);
    const shortfall = { ...zero };
    for (const r of RESOURCE_TYPES) shortfall[r] = Math.max(0, cost[r] - player.resources[r]);
    const affordable = RESOURCE_TYPES.every((r) => shortfall[r] === 0);
    if (wrongCiv || replaced) {
      return { available: false, hidden: true, reasons: [], cost, affordable, shortfall };
    }
    const reasons: UnavailableReason[] = [];
    if (def.age > player.age) reasons.push({ code: 'requiresAge', age: def.age });
    const owned = new Set<string>();
    let ownedCount = 0;
    for (const e of state.entities) {
      if (e.kind === 'building' && e.owner === playerId) {
        ownedCount += e.typeId === defId ? 1 : 0;
        if (e.constructed) owned.add(e.typeId);
      }
    }
    for (const b of def.requiresBuildings ?? []) if (!owned.has(b)) reasons.push({ code: 'requiresBuilding', buildingId: b });
    for (const t of def.requiresTechs ?? []) if (!player.researched.includes(t)) reasons.push({ code: 'requiresTech', techId: t });
    if (def.kind === 'building' && def.buildLimit !== undefined && ownedCount >= def.buildLimit) {
      reasons.push({ code: 'buildLimit', limit: def.buildLimit });
    }
    if (def.kind === 'tech') {
      if (player.researched.includes(def.id)) reasons.push({ code: 'alreadyResearched' });
      if (def.requiresAgeBuildings !== undefined && def.age <= player.age) {
        const types = new Set<string>();
        for (const e of state.entities) {
          if (e.kind !== 'building' || e.owner !== playerId || !e.constructed) continue;
          const bd = data.building(e.typeId);
          if (bd.countsTowardAge && bd.age === player.age) types.add(e.typeId);
        }
        if (types.size < def.requiresAgeBuildings) reasons.push({ code: 'ageBuildings', have: types.size, need: def.requiresAgeBuildings });
      }
    }
    return { available: reasons.length === 0, hidden: false, reasons, cost, affordable, shortfall };
  };
}

/** A `resolvedStat` that returns the data's base value (no modifiers). */
export function baseStat(data: DataRegistry = defaultRegistry): HudQueries['resolvedStat'] {
  return (_playerId, defId, stat: StatKey) => {
    const def = data.def(defId);
    if (def === undefined) throw new Error(`unknown def ${defId}`);
    if (def.kind === 'unit' && (stat === 'hp' || stat === 'attack' || stat === 'range' || stat === 'meleeArmor' || stat === 'pierceArmor')) return def.combat[stat];
    if (def.kind === 'building') {
      if (stat === 'hp' || stat === 'meleeArmor' || stat === 'pierceArmor') return def.combat[stat];
      if ((stat === 'attack' || stat === 'range') && def.combat.attack !== undefined) return def.combat.attack[stat];
    }
    if (stat === 'trainTime' && def.kind === 'unit') return def.trainTime;
    if (stat === 'buildTime' && def.kind === 'building') return def.buildTime;
    if (stat === 'researchTime' && def.kind === 'tech') return def.researchTime;
    if (stat === 'popProvided' && def.kind === 'building') return def.popProvided;
    if (stat === 'incomeRate' && def.kind === 'building' && def.income !== undefined) return def.income.perSecond;
    throw new Error(`no ${stat} for ${defId}`);
  };
}

/** Fake queries over a fixture state. */
export function fakeQueries(state: GameState, data: DataRegistry = defaultRegistry): HudQueries {
  return { availability: fakeAvailability(state, data), resolvedStat: baseStat(data) };
}
