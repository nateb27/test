/**
 * Public sim API (plan 2.8) and the fixed tick order (PLAN-M2 2.2). Owned by WP20 in M2, then the orchestrator.
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
import { runAcquisition } from './systems/combat/acquire';
import { runUnitAttacks } from './systems/combat/attack';
import { applyCommands } from './systems/commands';
import { runConstruction } from './systems/construct';
import { runDeath } from './systems/death';
import { runBuildingAttacks } from './systems/defence';
import { runIncome } from './systems/income';
import { emptyStats } from './systems/matchStats';
import { runMovement } from './systems/movement';
import { runObjectives } from './systems/objectives';
import { runOrders } from './systems/orders';
import { runOutcome } from './systems/outcome';
import { recomputePopulation } from './systems/population';
import { runProduction } from './systems/production';
import { runProjectiles } from './systems/projectiles';
import {
  NEUTRAL_PLAYER_ID,
  PLAYER_COLORS,
  type AiDifficulty,
  type Command,
  type GameConfig,
  type GameState,
  type MatchMode,
  type ObjectiveEntry,
  type PlayerConfig,
  type PlayerController,
  type PlayerState,
  type ReadonlyGameState,
  type Sim,
  type SimContext,
  type SimEvent,
  type SimQuery,
} from './types';

const NEUTRAL_COLOR = 0x9e9e9e;

const DIFFICULTY_NAMES: Record<AiDifficulty, string> = { easy: 'Easy', standard: 'Standard', hard: 'Hard' };

/** Identity of a player as copied into PlayerState (PLAN-M2 2.6, 3.5). */
interface PlayerIdentity {
  name: string;
  color: number;
  controller: PlayerController;
  difficulty: AiDifficulty | null;
}

/**
 * Defaults for slot `slot` (0-based; player id slot + 1): colour PLAYER_COLORS[slot]; controller 'human' for slot 0,
 * 'ai' for others when a difficulty is set, else 'human'; an AI slot without a difficulty plays 'standard'; names
 * 'Player', 'Player N' (other human slots) and 'Computer (<Difficulty>)'.
 */
export function playerIdentity(config: PlayerConfig, slot: number): PlayerIdentity {
  const controller: 'human' | 'ai' = config.controller ?? (slot > 0 && config.difficulty !== undefined ? 'ai' : 'human');
  const difficulty: AiDifficulty | null = controller === 'ai' ? (config.difficulty ?? 'standard') : null;
  const defaultName =
    difficulty !== null ? `Computer (${DIFFICULTY_NAMES[difficulty]})` : slot === 0 ? 'Player' : `Player ${slot + 1}`;
  const color = config.color ?? (PLAYER_COLORS[slot % PLAYER_COLORS.length] as { value: number }).value;
  return { name: config.name ?? defaultName, color, controller, difficulty };
}

/** A fresh player record (M1 fields plus the M2 identity, outcome and stats). */
export function makePlayer(id: number, civ: string | null, identity: PlayerIdentity, data: DataRegistry): PlayerState {
  const resources = civ === null ? { food: 0, wood: 0, gold: 0, stone: 0 } : { ...data.start.resources };
  return {
    id,
    civ,
    color: identity.color,
    resources,
    age: 1,
    popUsed: 0,
    popCap: 0,
    researched: [],
    cheats: { instantBuild: false, instantResearch: false },
    name: identity.name,
    controller: identity.controller,
    difficulty: identity.difficulty,
    outcome: 'playing',
    defeatedTick: null,
    stats: emptyStats(),
    alert: null,
  };
}

/** The neutral owner of resource nodes (player 0). */
export function makeNeutralPlayer(data: DataRegistry): PlayerState {
  return makePlayer(
    NEUTRAL_PLAYER_ID,
    null,
    { name: 'Neutral', color: NEUTRAL_COLOR, controller: 'neutral', difficulty: null },
    data,
  );
}

/** Match mode of a config: explicit, else 'conquest' with exactly 2 players, else 'sandbox'. */
export function matchModeOf(config: GameConfig): MatchMode {
  return config.mode ?? (config.players.length === 2 ? 'conquest' : 'sandbox');
}

/** Objectives per mode: sandbox players race to Age 4 (M1); conquest players have `conquest:<id>`. */
function objectivesFor(mode: MatchMode, players: readonly PlayerState[]): ObjectiveEntry[] {
  return players
    .filter((p) => p.id !== NEUTRAL_PLAYER_ID)
    .map((p) =>
      mode === 'conquest'
        ? { id: `conquest:${p.id}`, kind: 'conquest' as const, playerId: p.id, targetAge: null, completedTick: null }
        : { id: `reachEmpireAge:${p.id}`, kind: 'reachAge' as const, playerId: p.id, targetAge: 4 as const, completedTick: null },
    );
}

/** Build the initial state before map generation. */
export function createInitialState(config: GameConfig, data: DataRegistry): GameState {
  const seed = config.seed >>> 0;
  const size = config.mapSize;
  const terrain = data.terrains[0]?.id ?? 'grass';
  const players: PlayerState[] = [makeNeutralPlayer(data)];
  config.players.forEach((p, i) => {
    data.civ(p.civ); // throws for an unknown civ, as before
    players.push(makePlayer(i + 1, p.civ, playerIdentity(p, i), data));
  });
  const mode = matchModeOf(config);
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
    objectives: { entries: objectivesFor(mode, players) },
    projectiles: [],
    nextProjectileId: 1,
    match: { mode, winner: null, endedTick: null },
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

/** Advance one tick in the fixed order of PLAN-M2 2.2. */
function stepContext(ctx: SimContext, commands: readonly Command[]): SimEvent[] {
  ctx.events = [];
  applyCommands(ctx, commands); // 1
  runProduction(ctx); // 2
  runIncome(ctx); // 3
  runAcquisition(ctx); // 4 (rebuilds the spatial index)
  runOrders(ctx); // 5
  processPathQueue(ctx); // 6
  runMovement(ctx); // 7
  runUnitAttacks(ctx); // 8a
  runBuildingAttacks(ctx); // 8b
  runProjectiles(ctx); // 9
  runConstruction(ctx); // 10 (incl. construction hp and repair)
  runDeath(ctx); // 11, then
  runCleanup(ctx); // 11
  runOutcome(ctx); // 12, then
  runObjectives(ctx); // 12
  ctx.state.tick += 1; // 13
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
