import { describe, expect, it } from 'vitest';
import { deserialize, hashState, serialize } from '../../src/sim';
import type { CommandInput, Sim, SimEvent } from '../../src/sim/types';
import { makeGame, place, reload, townCenter, type Game } from './wp8helpers';

interface Scenario {
  game: Game;
  /** Commands to issue on a given tick (the tick value of `state.tick` before the step). */
  schedule: Map<number, CommandInput[]>;
}

function scenario(): Scenario {
  const g = makeGame({ seed: 5 });
  const tc = townCenter(g);
  const mill = place(g, 'mill');
  const barracks = place(g, 'barracks');
  const lumber = place(g, 'lumberCamp');
  place(g, 'house');
  place(g, 'house');
  reload(g);
  const schedule = new Map<number, CommandInput[]>();
  schedule.set(0, [
    { type: 'cheat', cheat: { kind: 'addResources', amounts: { food: 5000, wood: 5000, gold: 5000, stone: 5000 } } },
    { type: 'train', buildingId: tc.id, unitType: 'villager' },
    { type: 'train', buildingId: tc.id, unitType: 'villager' },
    { type: 'train', buildingId: barracks.id, unitType: 'spearman' },
    { type: 'setRally', buildingIds: [tc.id, barracks.id], x: 60.5, y: 60.5 },
  ]);
  schedule.set(100, [{ type: 'cancelQueue', buildingId: tc.id, index: 1 }]);
  schedule.set(500, [
    { type: 'cheat', cheat: { kind: 'instantResearch', enabled: true } },
    { type: 'research', buildingId: tc.id, techId: 'townshipAge' },
  ]);
  schedule.set(505, [
    { type: 'research', buildingId: lumber.id, techId: 'ironAxes' },
    { type: 'research', buildingId: mill.id, techId: 'irrigation' },
    { type: 'train', buildingId: tc.id, unitType: 'villager' },
  ]);
  return { game: g, schedule };
}

function commandsFor(sc: Scenario, sim: Sim, seq: { n: number }) {
  return (sc.schedule.get(sim.state.tick) ?? []).map((c) => ({ ...c, playerId: 1, seq: seq.n++ }) as never);
}

describe('WP8 determinism', () => {
  const TICKS = 560;
  // Hashing the whole state (120x120 map) is slow, so sample it densely only around the interesting ticks.
  const hashAt = (t: number): boolean => t % 20 === 0 || (t >= 498 && t <= 520) || t === TICKS - 1;
  let cached: ReturnType<typeof run> | null = null;
  const reference = (): ReturnType<typeof run> => (cached ??= run());

  function run(): { hashes: string[]; events: SimEvent[][]; sim: Sim } {
    const sc = scenario();
    const seq = { n: 1 };
    const hashes: string[] = [];
    const events: SimEvent[][] = [];
    for (let t = 0; t < TICKS; t++) {
      events.push(sc.game.sim.step(commandsFor(sc, sc.game.sim, seq)));
      if (hashAt(t)) hashes.push(hashState(sc.game.sim.state));
    }
    return { hashes, events, sim: sc.game.sim };
  }

  it('two runs with train and research commands produce identical hashes and events', () => {
    const a = reference();
    const b = run();
    expect(b.hashes).toEqual(a.hashes);
    expect(b.events).toEqual(a.events);
    // the scenario actually did something
    const flat = a.events.flat();
    expect(flat.some((e) => e.type === 'UnitTrained')).toBe(true);
    expect(flat.some((e) => e.type === 'AgeAdvanced')).toBe(true);
    expect(flat.filter((e) => e.type === 'ResearchCompleted')).toHaveLength(3);
    expect(flat.some((e) => e.type === 'CommandRejected')).toBe(false);
    expect(a.sim.state.players[1]!.age).toBe(2);
  }, 60_000);

  it.each([60, 250, 502, 507, 600])('save at tick %i, load, continue: identical to the uninterrupted run', (saveAt) => {
    const ref = reference();
    const sc = scenario();
    const seq = { n: 1 };
    let sim = sc.game.sim;
    const hashes: string[] = [];
    for (let t = 0; t < TICKS; t++) {
      if (t === saveAt) {
        const json = serialize(sim);
        const stats = ['gatherRate.wood', 'gatherRate.farm', 'carryCapacity'] as const;
        const before = stats.map((s) => sim.query.resolvedStat(1, 'villager', s));
        sim = deserialize(json);
        expect(serialize(sim)).toBe(json);
        // resolved stats come back from the researched list, not from the old cache
        expect(stats.map((s) => sim.query.resolvedStat(1, 'villager', s))).toEqual(before);
      }
      sim.step(commandsFor(sc, sim, seq));
      if (hashAt(t)) hashes.push(hashState(sim.state));
    }
    expect(hashes).toEqual(ref.hashes);
    expect(sim.query.resolvedStat(1, 'villager', 'gatherRate.wood')).toBeCloseTo(0.4 * 1.15, 12);
    expect(sim.query.resolvedStat(1, 'villager', 'gatherRate.farm')).toBeCloseTo(0.35 * 1.1 * 1.15, 12);
    expect(sim.query.resolvedStat(1, 'farm', 'cost.wood')).toBe(40);
  }, 60_000);

  it('the stat cache after load equals the cache before it', () => {
    const sc = scenario();
    const seq = { n: 1 };
    for (let t = 0; t < 520; t++) sc.game.sim.step(commandsFor(sc, sc.game.sim, seq));
    const loaded = deserialize(serialize(sc.game.sim));
    const defs = ['villager', 'farm', 'house', 'silkWorkshop', 'ironAxes', 'townCenter'] as const;
    const stats = ['gatherRate.wood', 'gatherRate.farm', 'speed', 'cost.wood', 'cost.food', 'buildTime', 'popProvided', 'researchTime', 'incomeRate', 'carryCapacity'] as const;
    let compared = 0;
    for (const d of defs) {
      for (const s of stats) {
        let before: number | null = null;
        try {
          before = sc.game.sim.query.resolvedStat(1, d, s);
        } catch {
          before = null;
        }
        if (before === null) continue;
        expect(loaded.query.resolvedStat(1, d, s)).toBe(before);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(10);
  });
});
