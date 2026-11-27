/**
 * Hand-built battle states for the WP21 combat tests: an empty 2-player map with the real content, entities placed
 * by hand, stepped through the real tick order (`simFromState` / `sim.step`).
 */

import { registry } from '../../src/data/index';
import { createBuilding, createUnit, findEntity } from '../../src/sim/entities';
import { rebuildRuntime } from '../../src/sim/runtime';
import { createInitialState, simFromState } from '../../src/sim/sim';
import { unitCombat } from '../../src/sim/systems/combat/damage';
import type {
  BuildingEntity,
  Command,
  GameState,
  PlayerId,
  ResolvedUnitCombat,
  Sim,
  SimContext,
  SimEvent,
  UnitEntity,
} from '../../src/sim/types';

export interface Battle {
  sim: Sim;
  /** The live state (mutable view of `sim.state`, for tests that move or hurt entities by hand). */
  state: GameState;
  events: SimEvent[];
  seq: number;
}

/** An empty `size` x `size` 2-player sandbox state (no Town Centers, no nodes). */
export function emptyBattleState(size = 48): GameState {
  const state = createInitialState({ seed: 1, mapSize: size, players: [{ civ: 'byzantines' }, { civ: 'byzantines' }], mode: 'sandbox' }, registry);
  return state;
}

/** Wrap a filled state in a Sim. */
export function battle(state: GameState): Battle {
  const sim = simFromState(state, registry);
  return { sim, state: sim.state as unknown as GameState, events: [], seq: 0 };
}

export function unit(state: GameState, type: string, owner: PlayerId, x: number, y: number): UnitEntity {
  return createUnit(state, type, owner, x, y);
}

export function building(state: GameState, type: string, owner: PlayerId, tx: number, ty: number, constructed = true): BuildingEntity {
  return createBuilding(state, type, owner, tx, ty, constructed);
}

/** One tick; returns that tick's events (also appended to `b.events`). */
export function step(b: Battle, commands: readonly Command[] = []): SimEvent[] {
  const events = b.sim.step(commands);
  b.events.push(...events);
  return events;
}

export function run(b: Battle, ticks: number, each?: () => void): void {
  for (let i = 0; i < ticks; i++) {
    step(b);
    each?.();
  }
}

/** Steps until `done()` (checked after each step) or `max` steps; returns the steps taken, or -1. */
export function runUntil(b: Battle, done: () => boolean, max: number): number {
  for (let i = 1; i <= max; i++) {
    step(b);
    if (done()) return i;
  }
  return -1;
}

export function get(b: Battle, id: number): UnitEntity {
  const e = findEntity(b.state, id);
  if (e === undefined || e.kind !== 'unit') throw new Error(`no unit ${id}`);
  return e;
}

export function getBuilding(b: Battle, id: number): BuildingEntity {
  const e = findEntity(b.state, id);
  if (e === undefined || e.kind !== 'building') throw new Error(`no building ${id}`);
  return e;
}

/** A side context sharing the battle's state (own runtime and events), for calling sim helpers directly. */
export function sideCtx(b: Battle): SimContext {
  return { state: b.state, runtime: rebuildRuntime(b.state, registry), data: registry, events: [] };
}

export function cmd<T extends Command['type']>(b: Battle, playerId: PlayerId, c: Omit<Extract<Command, { type: T }>, 'playerId' | 'seq'> & { type: T }): Command {
  b.seq += 1;
  return { ...c, playerId, seq: b.seq } as unknown as Command;
}

export function attack(b: Battle, playerId: PlayerId, unitIds: number[], targetId: number, queue = false): Command {
  return cmd(b, playerId, { type: 'attack', unitIds, targetId, queue });
}

export function attackMove(b: Battle, playerId: PlayerId, unitIds: number[], x: number, y: number, queue = false): Command {
  return cmd(b, playerId, { type: 'attackMove', unitIds, x, y, queue });
}

export function move(b: Battle, playerId: PlayerId, unitIds: number[], x: number, y: number): Command {
  return cmd(b, playerId, { type: 'move', unitIds, x, y, queue: false });
}

export function rejections(events: readonly SimEvent[]): string[] {
  return events.flatMap((e) => (e.type === 'CommandRejected' ? [e.reason] : []));
}

/** The resolved combat profile of a unit type for a player with no upgrades. */
export function resolved(owner: PlayerId, type: string): ResolvedUnitCombat {
  const state = emptyBattleState(8);
  const ctx: SimContext = { state, runtime: rebuildRuntime(state, registry), data: registry, events: [] };
  return unitCombat(ctx, owner, type);
}
