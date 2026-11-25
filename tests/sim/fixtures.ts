/**
 * Self-contained content for WP1 tests, so they do not depend on the numbers
 * WP4 puts in `src/data/`. Values follow plan sections 5.2 to 5.4.
 */

import { createRegistry, registry } from '../../src/data/index';
import type { BuildingDef, DataRegistry, NodeDef, UnitDef } from '../../src/data/schema';
import { createInitialState } from '../../src/sim/sim';
import { generateMapReport, type MapGenReport } from '../../src/sim/map/mapgen';
import { rebuildRuntime } from '../../src/sim/runtime';
import type { GameConfig, GameState, SimContext } from '../../src/sim/types';

function node(id: string, gatherKind: NodeDef['gatherKind'], resource: NodeDef['resource'], amount: number, footprint: number, maxGatherers: number): NodeDef {
  return {
    kind: 'node',
    id,
    name: id,
    resource,
    gatherKind,
    amount,
    footprint,
    blocking: true,
    maxGatherers,
    minimapColor: 0,
    sprite: `node.${id}`,
    icon: `icon.node.${id}`,
  };
}

const base = { name: 'x', description: '', age: 1 as const, tags: [], cost: {}, icon: 'icon.x' };

const townCenter: BuildingDef = {
  ...base,
  kind: 'building',
  id: 'townCenter',
  footprint: 4,
  blocking: true,
  buildable: false,
  buildTime: 1,
  popProvided: 10,
  dropOff: ['food', 'wood', 'gold', 'stone'],
  trains: [],
  researches: [],
  countsTowardAge: false,
  buildMenu: 'none',
  combat: { hp: 1, armor: 0 },
  sprite: 'building.townCenter',
};

const house: BuildingDef = { ...townCenter, id: 'house', footprint: 2, buildable: true, popProvided: 10 };

const villager: UnitDef = {
  ...base,
  kind: 'unit',
  id: 'villager',
  trainTime: 1,
  popCost: 1,
  speed: 1,
  combat: { hp: 1, attack: 0, armor: 0, range: 0 },
  sprite: 'unit.villager',
};

/** Registry with the five node types, a Town Center, a house and a villager. */
export const fixtureData: DataRegistry = createRegistry({
  units: [villager],
  buildings: [townCenter, house],
  techs: [],
  ages: registry.ages,
  civs: registry.civs,
  nodes: [
    node('tree', 'wood', 'wood', 100, 1, 1),
    node('berryBush', 'berries', 'food', 150, 1, 1),
    node('goldDeposit', 'gold', 'gold', 800, 2, 6),
    node('stoneDeposit', 'stone', 'stone', 600, 2, 6),
  ],
  terrains: registry.terrains,
  start: {
    resources: { food: 200, wood: 200, gold: 100, stone: 0 },
    centerBuilding: 'townCenter',
    units: [{ unitType: 'villager', count: 6 }],
  },
});

export function configFor(seed: number, players = 1, mapSize = 120): GameConfig {
  return { seed, mapSize, players: Array.from({ length: players }, () => ({ civ: 'byzantines' })) };
}

/** Generate a map without wrapping it in a Sim, to inspect the report. */
export function generate(
  seed: number,
  players = 1,
  mapSize = 120,
  data: DataRegistry = fixtureData,
): { ctx: SimContext; state: GameState; report: MapGenReport } {
  const config = configFor(seed, players, mapSize);
  const state = createInitialState(config, data);
  const ctx: SimContext = { state, runtime: rebuildRuntime(state, data), data, events: [] };
  const report = generateMapReport(ctx, config);
  return { ctx, state, report };
}
