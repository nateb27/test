/**
 * Public sim API (plan 2.8) and the fixed tick order (plan 2.7). Owned by WP1.
 * Do not reorder the steps in `step` without updating the determinism tests.
 */

import { registry } from '../data/index';
import type { DataRegistry } from '../data/schema';
import { generateMap } from './map/mapgen';
import { processPathQueue } from './path/queue';
import { entitiesInRect, entityAtPoint, entityById } from './query';
import { createRng } from './rng';
import { availability } from './rules/availability';
import { canPlace } from './rules/placement';
import { resolvedStat } from './rules/stats';
import { rebuildRuntime } from './runtime';
import { runCleanup } from './systems/cleanup';
import { applyCommands } from './systems/commands';
import { runConstruction } from './systems/construct';
import { runIncome } from './systems/income';
import { runMovement } from './systems/movement';
import { runObjectives } from './systems/objectives';
import { runOrders } from './systems/orders';
import { recomputePopulation } from './systems/population';
import { runProduction } from './systems/production';
import {
  NEUTRAL_PLAYER_ID,
  type Command,
  type GameConfig,
  type GameState,
  type PlayerState,
  type ReadonlyGameState,
  type Sim,
  type SimContext,
  type SimEvent,
  type SimQuery,
} from './types';

const NEUTRAL_COLOR = 0x9e9e9e;

function makePlayer(id: number, civ: string | null, color: number, data: DataRegistry): PlayerState {
  const resources = civ === null ? { food: 0, wood: 0, gold: 0, stone: 0 } : { ...data.start.resources };
  return {
    id,
    civ,
    color,
    resources,
    age: 1,
    popUsed: 0,
    popCap: 0,
    researched: [],
    cheats: { instantBuild: false, instantResearch: false },
  };
}

/** Build the initial state before map generation. */
export function createInitialState(config: GameConfig, data: DataRegistry): GameState {
  const seed = config.seed >>> 0;
  const size = config.mapSize;
  const terrain = data.terrains[0]?.id ?? 'grass';
  const players: PlayerState[] = [makePlayer(NEUTRAL_PLAYER_ID, null, NEUTRAL_COLOR, data)];
  config.players.forEach((p, i) => {
    players.push(makePlayer(i + 1, p.civ, data.civ(p.civ).palette.primary, data));
  });
  return {
    tick: 0,
    seed,
    mapSeed: seed,
    rng: createRng(seed),
    nextEntityId: 1,
    occupancyVersion: 0,
    nextPathRequestId: 1,
    map: { width: size, height: size, tiles: new Array<string>(size * size).fill(terrain) },
    players,
    entities: [],
    pathQueue: [],
    objectives: {
      entries: players
        .filter((p) => p.id !== NEUTRAL_PLAYER_ID)
        .map((p) => ({
          id: `reachEmpireAge:${p.id}`,
          kind: 'reachAge' as const,
          playerId: p.id,
          targetAge: 4 as const,
          completedTick: null,
        })),
    },
  };
}

function makeQuery(ctx: SimContext): SimQuery {
  return {
    entityById: (id) => entityById(ctx, id),
    entitiesInRect: (x0, y0, x1, y1) => entitiesInRect(ctx, x0, y0, x1, y1),
    entityAtPoint: (x, y) => entityAtPoint(ctx, x, y),
    availability: (playerId, defId) => availability(ctx, playerId, defId),
    canPlace: (playerId, type, tx, ty) => canPlace(ctx, playerId, type, tx, ty),
    resolvedStat: (playerId, defId, stat) => resolvedStat(ctx, playerId, defId, stat),
  };
}

/** Advance one tick in the fixed order of plan 2.7. */
function stepContext(ctx: SimContext, commands: readonly Command[]): SimEvent[] {
  ctx.events = [];
  applyCommands(ctx, commands); // 1
  runProduction(ctx); // 2
  runIncome(ctx); // 3
  runOrders(ctx); // 4
  processPathQueue(ctx); // 5
  runMovement(ctx); // 6
  runConstruction(ctx); // 7
  runCleanup(ctx); // 8
  runObjectives(ctx); // 9
  ctx.state.tick += 1;
  const events = ctx.events;
  ctx.events = [];
  return events;
}

/** Wrap an existing state (taken over, not copied) in a Sim. Rebuilds the runtime. */
export function simFromState(state: GameState, data: DataRegistry = registry): Sim {
  const ctx: SimContext = { state, runtime: rebuildRuntime(state, data), data, events: [] };
  recomputePopulation(ctx);
  const query = makeQuery(ctx);
  return {
    get state(): ReadonlyGameState {
      return ctx.state;
    },
    step: (commands) => stepContext(ctx, commands),
    query,
  };
}

/** Create a new match. */
export function createGame(config: GameConfig, data: DataRegistry = registry): Sim {
  const state = createInitialState(config, data);
  const ctx: SimContext = { state, runtime: rebuildRuntime(state, data), data, events: [] };
  generateMap(ctx, config);
  return simFromState(state, data);
}
