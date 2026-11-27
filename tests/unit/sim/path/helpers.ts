/**
 * Test helpers for WP2: hand-made grids, states and contexts that do not
 * depend on WP1's entity store, occupancy builder or map generator.
 */

import { registry } from '../../../../src/data/index';
import type { PathGrid } from '../../../../src/sim/path/grid';
import { processPathQueue } from '../../../../src/sim/path/queue';
import { runMovement } from '../../../../src/sim/systems/movement';
import { applyStopCommand, runOrders } from '../../../../src/sim/systems/orders/index';
import { applyMoveCommand } from '../../../../src/sim/systems/orders/move';
import { createSpatialIndex } from '../../../../src/sim/systems/combat/spatial';
import { ACQUIRE_BUDGET_PER_TICK, type Command, type GameState, type SimContext, type UnitEntity } from '../../../../src/sim/types';
import { M2_STATE_FIELDS, m2PlayerFields } from '../../../sim/fixtures';

/** Grid from ASCII rows: '#' is blocked, anything else walkable. */
export function gridFromAscii(rows: readonly string[]): PathGrid {
  const height = rows.length;
  const width = rows[0]!.length;
  const blocked = new Uint8Array(width * height);
  rows.forEach((row, y) => {
    for (let x = 0; x < width; x++) if (row[x] === '#') blocked[y * width + x] = 1;
  });
  return { width, height, blocked, version: 0 };
}

export function openGrid(width: number, height: number): PathGrid {
  return { width, height, blocked: new Uint8Array(width * height), version: 0 };
}

/** Small deterministic LCG for test fixtures. */
export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Random obstacle grid with the given blocked fraction. */
export function randomGrid(width: number, height: number, density: number, seed: number): PathGrid {
  const rnd = lcg(seed);
  const blocked = new Uint8Array(width * height);
  for (let i = 0; i < blocked.length; i++) blocked[i] = rnd() < density ? 1 : 0;
  return { width, height, blocked, version: 0 };
}

export function makeState(width: number, height: number): GameState {
  return {
    tick: 0,
    seed: 1,
    mapSeed: 1,
    rng: { a: 1, b: 2, c: 3, d: 4 },
    nextEntityId: 1,
    occupancyVersion: 0,
    nextPathRequestId: 1,
    map: { width, height, tiles: new Array<string>(width * height).fill('grass') },
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
      ...m2PlayerFields(id),
    })),
    entities: [],
    pathQueue: [],
    objectives: { entries: [] },
    ...M2_STATE_FIELDS(),
  };
}

export const TEST_UNIT = 'testWalker';
export const TEST_SPEED = 2;

/** Context over `state` with an explicit occupancy grid and a known unit speed. */
export function makeCtx(state: GameState, occupancy: Uint8Array): SimContext {
  const resolvedStats: SimContext['runtime']['resolvedStats'] = state.players.map(() => ({
    [TEST_UNIT]: { speed: TEST_SPEED },
  }));
  const runtime: SimContext['runtime'] = {
    occupancy,
    resolvedStats,
    pendingRemoval: [],
    combat: state.players.map(() => ({})),
    spatial: createSpatialIndex(state.map.width, state.map.height),
    acquireBudget: ACQUIRE_BUDGET_PER_TICK,
  };
  return { state, runtime, data: registry, events: [] };
}

export function addUnit(state: GameState, owner: number, x: number, y: number): UnitEntity {
  const unit: UnitEntity = {
    id: state.nextEntityId++,
    kind: 'unit',
    owner,
    typeId: TEST_UNIT,
    pos: { x, y },
    prevPos: { x, y },
    facing: 0,
    orderQueue: [],
    currentOrder: null,
    path: null,
    pendingPathRequestId: null,
    carried: null,
    hp: 1,
    stance: 'aggressive',
    combat: { cooldown: 0, windup: 0, swingTargetId: null, nextScanTick: 0, lastAttackTick: null },
    lastAttackerId: null,
    lastDamagedTick: null,
  };
  state.entities.push(unit);
  return unit;
}

/** Change a tile's blocking status the way the sim must: also bump the version. */
export function setBlocked(ctx: SimContext, tx: number, ty: number, value: number): void {
  ctx.runtime.occupancy[ty * ctx.state.map.width + tx] = value;
  ctx.state.occupancyVersion++;
}

export interface StepStats {
  expanded: number;
}

/** The WP2 part of the tick: commands (move/stop only), orders, pathfinding, movement. */
export function step(ctx: SimContext, commands: readonly Command[] = []): StepStats {
  ctx.events = [];
  for (const cmd of commands) {
    if (cmd.type === 'move') applyMoveCommand(ctx, cmd);
    else if (cmd.type === 'stop') applyStopCommand(ctx, cmd);
    else throw new Error(`test step: unsupported command ${cmd.type}`);
  }
  runOrders(ctx);
  const expanded = processPathQueue(ctx);
  runMovement(ctx);
  ctx.state.tick++;
  return { expanded };
}

let seq = 0;
export function moveCmd(playerId: number, unitIds: number[], x: number, y: number, queue = false): Command {
  return { type: 'move', playerId, seq: ++seq, unitIds, x, y, queue };
}
