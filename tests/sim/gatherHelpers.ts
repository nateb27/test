/**
 * Helpers for WP6 tests: a tiny registry (a gatherer, a soldier, drop-offs,
 * a farm and the four node types), hand-built states and a tick function
 * that runs the sim steps gathering depends on (commands, orders, pathfinding,
 * movement, cleanup), so the tests do not rely on other packages' systems.
 */

import { createRegistry, registry } from '../../src/data/index';
import type { BuildingDef, DataRegistry, UnitDef } from '../../src/data/schema';
import { createBuilding, createNode, createUnit } from '../../src/sim/entities';
import { buildOccupancy } from '../../src/sim/map/occupancy';
import { processPathQueue } from '../../src/sim/path/queue';
import { rebuildRuntime } from '../../src/sim/runtime';
import { runCleanup } from '../../src/sim/systems/cleanup';
import { applyCommands } from '../../src/sim/systems/commands';
import { runMovement } from '../../src/sim/systems/movement';
import { runOrders } from '../../src/sim/systems/orders/index';
import type {
  BuildingEntity,
  Command,
  GameState,
  GatherKind,
  ResourceNodeEntity,
  SimContext,
  SimEvent,
  UnitEntity,
} from '../../src/sim/types';
import { fixtureData } from './fixtures';

export const GATHERER = 'tester';
export const SOLDIER = 'soldier';

/** Rates that are exact binary fractions per tick (rate / 20). */
export const EXACT_RATES: Partial<Record<GatherKind, number>> = {
  wood: 5,
  berries: 2.5,
  farm: 5,
  gold: 10,
  stone: 1.25,
};
/** The plan's villager rates. */
export const PLAN_RATES: Partial<Record<GatherKind, number>> = {
  wood: 0.4,
  berries: 0.33,
  farm: 0.35,
  gold: 0.38,
  stone: 0.36,
};

const baseDef = { name: 'x', description: '', age: 1 as const, tags: [], cost: {}, icon: 'icon.x' };

function unitDef(id: string, gather: UnitDef['gather']): UnitDef {
  const def: UnitDef = {
    ...baseDef,
    kind: 'unit',
    id,
    trainTime: 1,
    popCost: 1,
    speed: 2,
    combat: { hp: 1, attack: 0, armor: 0, range: 0 },
    sprite: `unit.${id}`,
  };
  if (gather !== undefined) def.gather = gather;
  return def;
}

function buildingDef(id: string, footprint: number, blocking: boolean, extra: Partial<BuildingDef>): BuildingDef {
  return {
    ...baseDef,
    kind: 'building',
    id,
    footprint,
    blocking,
    buildable: true,
    buildTime: 1,
    popProvided: 0,
    dropOff: [],
    trains: [],
    researches: [],
    countsTowardAge: false,
    buildMenu: 'none',
    combat: { hp: 1, armor: 0 },
    sprite: `building.${id}`,
    ...extra,
  };
}

export function makeData(rates: Partial<Record<GatherKind, number>> = EXACT_RATES, carryCapacity = 10): DataRegistry {
  return createRegistry({
    units: [unitDef(GATHERER, { rates, carryCapacity }), unitDef(SOLDIER, undefined)],
    buildings: [
      buildingDef('townCenter', 4, true, { dropOff: ['food', 'wood', 'gold', 'stone'], buildable: false }),
      buildingDef('lumberCamp', 2, true, { dropOff: ['wood'] }),
      buildingDef('mill', 2, true, { dropOff: ['food'] }),
      buildingDef('farm', 2, false, { farm: { resource: 'food', gatherKind: 'farm', maxGatherers: 1 } }),
      buildingDef('house', 2, true, {}),
    ],
    techs: [],
    ages: registry.ages,
    civs: registry.civs,
    nodes: fixtureData.nodes,
    terrains: registry.terrains,
    start: fixtureData.start,
  });
}

export function emptyState(size = 40): GameState {
  return {
    tick: 0,
    seed: 1,
    mapSeed: 1,
    rng: { a: 1, b: 2, c: 3, d: 4 },
    nextEntityId: 1,
    occupancyVersion: 0,
    nextPathRequestId: 1,
    map: { width: size, height: size, tiles: new Array<string>(size * size).fill('grass') },
    players: [0, 1, 2].map((id) => ({
      id,
      civ: id === 0 ? null : 'byzantines',
      color: 0,
      resources: { food: 0, wood: 0, gold: 0, stone: 0 },
      age: 1 as const,
      popUsed: 0,
      popCap: 0,
      researched: [],
      cheats: { instantBuild: false, instantResearch: false },
    })),
    entities: [],
    pathQueue: [],
    objectives: { entries: [] },
  };
}

export interface World {
  state: GameState;
  ctx: SimContext;
  data: DataRegistry;
  events: SimEvent[];
}

/** Build a world: `fill` adds entities to the state before the runtime is built. */
export function makeWorld(fill: (state: GameState) => void, data: DataRegistry = makeData()): World {
  const state = emptyState();
  fill(state);
  const ctx: SimContext = { state, runtime: rebuildRuntime(state, data), data, events: [] };
  return { state, ctx, data, events: [] };
}

/** Recompute the occupancy grid after the test changed entities by hand. */
export function refreshOccupancy(w: World): void {
  w.ctx.runtime.occupancy.set(buildOccupancy(w.state, w.data));
  w.state.occupancyVersion += 1;
}

/** One tick: commands, orders, pathfinding, movement, cleanup. Events accumulate in `w.events`. */
export function tick(w: World, commands: readonly Command[] = []): void {
  const { ctx } = w;
  ctx.events = [];
  applyCommands(ctx, commands);
  runOrders(ctx);
  processPathQueue(ctx);
  runMovement(ctx);
  runCleanup(ctx);
  ctx.state.tick += 1;
  w.events.push(...ctx.events);
}

export function run(w: World, ticks: number, each?: (t: number) => void): void {
  for (let t = 0; t < ticks; t++) {
    tick(w);
    each?.(t);
  }
}

/** Run until `done()` or `max` ticks; returns the ticks used (or -1 on timeout). */
export function runUntil(w: World, done: () => boolean, max: number): number {
  for (let t = 0; t < max; t++) {
    tick(w);
    if (done()) return t + 1;
  }
  return -1;
}

let seq = 0;
export function gatherCmd(playerId: number, unitIds: number[], nodeId: number, queue = false): Command {
  return { type: 'gather', playerId, seq: ++seq, unitIds, nodeId, queue };
}
export function dropOffCmd(playerId: number, unitIds: number[], buildingId: number): Command {
  return { type: 'dropOff', playerId, seq: ++seq, unitIds, buildingId };
}
export function moveCmd(playerId: number, unitIds: number[], x: number, y: number): Command {
  return { type: 'move', playerId, seq: ++seq, unitIds, x, y, queue: false };
}

export function rejections(w: World): string[] {
  return w.events.flatMap((e) => (e.type === 'CommandRejected' ? [e.reason] : []));
}
export function idleEvents(w: World): number {
  return w.events.filter((e) => e.type === 'VillagerIdle').length;
}

export function villager(state: GameState, x: number, y: number, owner = 1, type = GATHERER): UnitEntity {
  return createUnit(state, type, owner, x, y);
}
export function tree(state: GameState, tx: number, ty: number, amount = 100): ResourceNodeEntity {
  return createNode(state, 'tree', tx, ty, amount);
}
export function building(state: GameState, type: string, tx: number, ty: number, constructed = true, owner = 1): BuildingEntity {
  return createBuilding(state, type, owner, tx, ty, constructed);
}

export function unitOf(w: World, id: number): UnitEntity {
  const e = w.state.entities.find((x) => x.id === id);
  if (e === undefined || e.kind !== 'unit') throw new Error(`no unit ${id}`);
  return e;
}
export function nodeOf(w: World, id: number): ResourceNodeEntity | undefined {
  const e = w.state.entities.find((x) => x.id === id);
  return e !== undefined && e.kind === 'node' ? e : undefined;
}
