/**
 * WP12: long-run determinism and replay (plan 9.1).
 *
 * A rich scripted game (gathering, building, training, research through all
 * four ages, deletes, cancels, rally points, invalid commands) is recorded
 * once by `generateScript`. The recorded log is then replayed through the
 * sim-layer `replay` utility: twice for the full 30,000 ticks with a state
 * hash every 100 ticks, and again with `serialize`/`deserialize` round trips
 * at several seeded random ticks. Every hash must match the recording.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import {
  commandLogFromJson,
  createGame,
  commandLogToJson,
  deserialize,
  hashState,
  replay,
  serialize,
  type GameConfig,
  type Sim,
} from '../../src/sim';
import { createRng, rngInt } from '../../src/sim/rng';
import { generateScript, type ScriptRun } from './scriptGen';

const TICKS = 30_000;
const HASH_EVERY = 100;
const CONFIG: GameConfig = { seed: 7, mapSize: 120, players: [{ civ: 'byzantines' }] };
const SCRIPT_SEED = 99;

const LONG = 120_000;
let run: ScriptRun;
let final: Sim;

beforeAll(() => {
  run = generateScript(CONFIG, TICKS, SCRIPT_SEED, HASH_EVERY);
}, LONG);

/** `count` distinct ticks in [1, ticks), from a seeded generator. */
function randomTicks(seed: number, count: number, ticks: number): number[] {
  const rng = createRng(seed);
  const set = new Set<number>();
  while (set.size < count) set.add(1 + rngInt(rng, ticks - 1));
  return [...set].sort((a, b) => a - b);
}

describe('scripted game (30,000 ticks)', () => {
  it('is rich: every command type, all four ages, queues held at the population cap', () => {
    for (const type of [
      'move', 'gather', 'build', 'dropOff', 'stop', 'train', 'research',
      'cancelQueue', 'cancelConstruction', 'setRally', 'delete', 'cheat',
    ]) {
      expect(run.commandCounts[type], type).toBeGreaterThan(0);
    }
    expect(run.age).toBe(4);
    expect(run.eventCounts.AgeAdvanced).toBe(3);
    expect(run.eventCounts.ObjectiveCompleted).toBe(1);
    expect(run.eventCounts.BuildingCompleted).toBeGreaterThan(20);
    expect(run.eventCounts.UnitTrained).toBeGreaterThan(50);
    expect(run.eventCounts.PopulationCapped).toBeGreaterThan(0);
    expect(run.eventCounts.CommandRejected).toBeGreaterThan(0);
    expect(run.hashes).toHaveLength(TICKS / HASH_EVERY);
  });

  it('the log survives a JSON round trip unchanged', () => {
    expect(commandLogFromJson(commandLogToJson(run.log))).toEqual(run.log);
  });

  it('replays twice with identical hashes every 100 ticks, equal to the recording', () => {
    const a = replay(CONFIG, run.log, TICKS, { hashEvery: HASH_EVERY });
    const b = replay(CONFIG, run.log, TICKS, { hashEvery: HASH_EVERY });
    expect(a.hashes).toHaveLength(TICKS / HASH_EVERY);
    expect(b.hashes).toEqual(a.hashes);
    expect(a.hashes).toEqual(run.hashes);
    expect(a.finalHash).toBe(run.finalHash);
    expect(serialize(a.sim)).toBe(serialize(b.sim));
    final = a.sim;
  }, LONG);

  it('is unchanged by serialize/deserialize at seeded random points', () => {
    const points = randomTicks(2024, 12, TICKS);
    const loaded = replay(CONFIG, run.log, TICKS, { hashEvery: HASH_EVERY, saveLoadAt: points });
    expect(loaded.hashes).toEqual(run.hashes);
    expect(loaded.finalHash).toBe(run.finalHash);
  }, LONG);

  it('is unchanged by a save and load every 50 ticks through a busy stretch', () => {
    // Dense save points where the state is busiest (the middle of the game).
    const points: number[] = [];
    for (let t = 12_000; t < 13_000; t += 50) points.push(t);
    const loaded = replay(CONFIG, run.log, 13_000, { hashEvery: HASH_EVERY, saveLoadAt: points });
    expect(loaded.hashes).toEqual(run.hashes.filter(([tick]) => tick <= 13_000));
  }, LONG);

  it('a different map seed with the same script seed gives a different (also repeatable) game', () => {
    const other: GameConfig = { ...CONFIG, seed: 8 };
    const a = generateScript(other, 4000, SCRIPT_SEED, HASH_EVERY);
    const b = replay(other, a.log, 4000, { hashEvery: HASH_EVERY });
    expect(b.hashes).toEqual(a.hashes);
    expect(a.hashes[39]![1]).not.toBe(run.hashes[39]![1]);
  }, LONG);

  it('the state stays valid canonical JSON throughout (no NaN, -0, undefined, class instances)', () => {
    // hashState throws on any of those; check the final state of the first replay and a loaded copy.
    expect(() => hashState(final.state)).not.toThrow();
    expect(hashState(deserialize(serialize(final)).state)).toBe(hashState(final.state));
  });

  it('two matches stepped alternately in one process do not disturb each other (no shared scratch state)', () => {
    const ticks = 3000;
    const other: GameConfig = { ...CONFIG, seed: 21 };
    const second = generateScript(other, ticks, 5, HASH_EVERY);
    const alone = replay(CONFIG, run.log, ticks, { hashEvery: HASH_EVERY });
    // Interleave tick by tick: A, B, A, B ...
    const a = createGame(CONFIG);
    const b = createGame(other);
    const hashesA: [number, string][] = [];
    const hashesB: [number, string][] = [];
    let ia = 0;
    let ib = 0;
    for (let t = 0; t < ticks; t++) {
      const ca = run.log[ia]?.tick === t ? run.log[ia++]!.commands : [];
      const cb = second.log[ib]?.tick === t ? second.log[ib++]!.commands : [];
      a.step(ca);
      b.step(cb);
      if ((t + 1) % HASH_EVERY === 0) {
        hashesA.push([t + 1, hashState(a.state)]);
        hashesB.push([t + 1, hashState(b.state)]);
      }
    }
    expect(hashesA).toEqual(alone.hashes);
    expect(hashesB).toEqual(second.hashes);
  }, LONG);

  it('loading does not depend on key order or whitespace in the file', () => {
    const at = 2500;
    const mid = replay(CONFIG, run.log, at).sim;
    const scramble = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(scramble);
      if (v !== null && typeof v === 'object') {
        const entries = Object.entries(v as Record<string, unknown>).reverse();
        return Object.fromEntries(entries.map(([k, x]) => [k, scramble(x)]));
      }
      return v;
    };
    const text = JSON.stringify(scramble(JSON.parse(serialize(mid))), null, 2);
    expect(text).not.toBe(serialize(mid));
    const loaded = deserialize(text);
    expect(serialize(loaded)).toBe(serialize(mid));
    const tail = run.log.filter((e) => e.tick >= at && e.tick < at + 1500);
    let i = 0;
    for (let t = at; t < at + 1500; t++) {
      const cmds = tail[i]?.tick === t ? tail[i++]!.commands : [];
      mid.step(cmds);
      loaded.step(cmds);
    }
    expect(hashState(loaded.state)).toBe(hashState(mid.state));
  }, LONG);
});
