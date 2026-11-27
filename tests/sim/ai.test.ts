/**
 * AI acceptance (PLAN-M2 8.1, AI items 1-3 and 5-8). Headless matches through `tests/sim/aiHarness.ts`, driven like
 * `Match.tick()`. Per-seed timings are printed so BALANCE.md can quote them; the 5-seed table and the full ladder are
 * in `ai.long.test.ts` (`npm run test:long`).
 */

import { describe, expect, it } from 'vitest';
import { AiPlayer } from '../../src/bot';
import { DIFFICULTY } from '../../src/bot/ai/difficulty';
import { aiSeed, initialMemory, parseMemory } from '../../src/bot/ai/memory';
import { SaveError, TICK_RATE, createGame, createRng, deserializeSave, serialize, type AiDifficulty } from '../../src/sim';
import { FIRST_WAVE, TOWNSHIP, expectHygiene, fmtTick, matchConfig, opening, playMatch, MIN } from './aiHarness';

const DIFFS: readonly AiDifficulty[] = ['easy', 'standard', 'hard'];
const SEEDS = [1, 2, 3];
const SLOW = 900_000;

describe('AI openings against an idle opponent (8.1 items 1, 2, 5, 6)', () => {
  describe.each(DIFFS)('%s', (diff) => {
    it.each(SEEDS)('seed %i: Township and first-wave launch inside the 5.5 windows; clean commands; nothing stuck', (seed) => {
      const r = opening(diff, seed);
      const s = r.seats[0]!;
      const township = s.ageTicks[1];
      console.info(`[ai] ${diff} seed ${seed}: Township ${fmtTick(township)}, first wave ${fmtTick(s.firstWaveTick)}, army ${s.army}`);
      expect(township, 'Township reached').not.toBeNull();
      expect(township! / TICK_RATE).toBeGreaterThanOrEqual(TOWNSHIP[diff][0]);
      expect(township! / TICK_RATE).toBeLessThanOrEqual(TOWNSHIP[diff][1]);
      expect(s.firstWaveTick, 'first wave launched').not.toBeNull();
      expect(s.firstWaveTick! / TICK_RATE).toBeGreaterThanOrEqual(FIRST_WAVE[diff][0]);
      expect(s.firstWaveTick! / TICK_RATE).toBeLessThanOrEqual(FIRST_WAVE[diff][1]);
      expectHygiene(s);
      expect(s.stuck).toEqual([]);
    }, SLOW);
  });

  it('decides only on its own cadence ticks: (tick + playerId * 7) % interval === 0', () => {
    for (const diff of DIFFS) {
      const sim = createGame(matchConfig(4, ['idle', diff]));
      const ai = AiPlayer.create(2, diff, 4);
      const interval = DIFFICULTY[diff].decisionInterval;
      let due = 0;
      let lastSeq = 0;
      for (let t = 0; t < 600; t++) {
        const cmds = ai.update(sim);
        if ((sim.state.tick + 14) % interval === 0) due++;
        else expect(cmds).toEqual([]);
        for (const c of cmds) {
          expect(c.playerId).toBe(2);
          expect(c.seq).toBeGreaterThan(lastSeq);
          lastSeq = c.seq;
        }
        sim.step(cmds);
      }
      expect(ai.memory.decisions).toBe(due);
    }
  });
});

describe('AI full matches (8.1 items 3, 5, 6)', () => {
  it('Hard beats Easy on seed 1 before 35:00, with clean commands and nothing stuck', () => {
    const r = playMatch({ seed: 1, seats: ['hard', 'easy'], maxTicks: 35 * MIN });
    console.info(`[ai] hard vs easy seed 1: winner ${r.winner} at ${fmtTick(r.endTick)}`);
    expect(r.winner).toBe(1);
    expect(r.endTick).toBeLessThanOrEqual(35 * MIN);
    for (const s of r.seats) {
      expectHygiene(s);
      expect(s.stuck, `player ${s.playerId} stuck units`).toEqual([]);
    }
  }, SLOW);

  it('Standard beats Easy on seed 1 before 45:00, with clean commands and nothing stuck', () => {
    const r = playMatch({ seed: 1, seats: ['standard', 'easy'], maxTicks: 45 * MIN });
    console.info(`[ai] standard vs easy seed 1: winner ${r.winner} at ${fmtTick(r.endTick)}`);
    expect(r.winner).toBe(1);
    expect(r.endTick).toBeLessThanOrEqual(45 * MIN);
    for (const s of r.seats) {
      expectHygiene(s);
      expect(s.stuck, `player ${s.playerId} stuck units`).toEqual([]);
    }
  }, SLOW);
});

describe('AI memory (6.2, 8.1 item 7)', () => {
  it('seeds its own stream from seed and player id, never from state.rng', () => {
    expect(initialMemory(7, 2).rng).toEqual(createRng(aiSeed(7, 2)));
    expect(aiSeed(7, 2)).toBe((7 ^ (2 * 0x9e3779b9)) >>> 0);
    expect(aiSeed(7, 1)).not.toBe(aiSeed(7, 2));
    // The stream lives in memory and advances only through the AI's own draws (the first-wave jitter).
    const sim = createGame(matchConfig(7, ['hard', 'standard']));
    const a = AiPlayer.create(1, 'hard', 7);
    const b = AiPlayer.create(1, 'hard', 7);
    for (let t = 0; t < 40; t++) {
      expect(JSON.stringify(b.update(sim))).toBe(JSON.stringify(a.update(sim)));
      sim.step([]);
    }
    expect(a.memory.rng).not.toEqual(initialMemory(7, 1).rng);
    expect(a.memory).toEqual(b.memory);
    expect(a.memory.nextWaveEarliestTick).toBeGreaterThanOrEqual(DIFFICULTY.hard.wave.earliest * TICK_RATE);
    expect(a.memory.nextWaveEarliestTick).toBeLessThanOrEqual((DIFFICULTY.hard.wave.earliest + DIFFICULTY.hard.wave.jitter) * TICK_RATE);
  });

  it('restoring memory gives identical commands and hashes (saves every 700 ticks over 4,200 ticks)', () => {
    const opts = { seed: 3, seats: ['hard', 'standard'] as const, maxTicks: 4200, hashEvery: 100, log: true, trackStuck: false };
    const a = playMatch({ ...opts, seats: [...opts.seats] });
    const b = playMatch({ ...opts, seats: [...opts.seats], saveEvery: 700 });
    expect(b.hashes).toEqual(a.hashes);
    expect(JSON.stringify(b.log)).toBe(JSON.stringify(a.log));
    expect(a.log.flat().length).toBeGreaterThan(50);
  }, SLOW);

  it('memory round-trips through a v2 save file exactly', () => {
    const r = playMatch({ seed: 2, seats: ['standard', 'hard'], maxTicks: 3000, trackStuck: false });
    const saves = r.controllers.map((c) => c!.save()!);
    const loaded = deserializeSave(serialize(r.sim, saves));
    expect(loaded.controllers).toEqual(saves);
    for (const s of loaded.controllers) expect(AiPlayer.restore(s).save()).toEqual(s);
  });

  it('refuses damaged memory with SaveError("corrupt")', () => {
    const good = AiPlayer.create(1, 'standard', 1).save();
    const mem = good.memory as Record<string, unknown>;
    const bad: unknown[] = [
      null,
      {},
      { ...mem, version: 2 },
      { ...mem, seq: 0 },
      { ...mem, phase: 'dancing' },
      { ...mem, rng: { a: -1, b: 0, c: 0, d: 0 } },
      { ...mem, wave: { unitIds: [3, 2], targetId: null, orderX: 0, orderY: 0, launchTick: 0, startPower: 0, retreatTick: null } },
      { ...mem, desiredBuildings: [{ type: 'stable', count: 1 }, { type: 'barracks', count: 1 }] },
      { ...mem, bank: { food: 1.5, wood: 0, gold: 0, stone: 0 } },
    ];
    for (const m of bad) {
      expect(() => parseMemory(m as never), JSON.stringify(m)?.slice(0, 80)).toThrow(SaveError);
      expect(() => AiPlayer.restore({ ...good, memory: m as never })).toThrow(SaveError);
    }
    expect(() => AiPlayer.restore({ ...good, kind: 'robot' as never })).toThrow(SaveError);
    expect(() => AiPlayer.restore({ ...good, difficulty: 'brutal' as never })).toThrow(SaveError);
  });
});

describe('AI decision cost (6.7, 8.1 item 8)', () => {
  it('stays inside the operation budget and (generously) the time budget in a full match', () => {
    // The match is deterministic, so every decision happens in both runs; for each decision the faster run counts.
    // Machine load slows a decision in one run, not the same decision in both, while a really slow decision is slow
    // in both (the approach of tests/sim/perfHarness.ts). The operation counts are the deterministic gate.
    const play = () => playMatch({ seed: 1, seats: ['hard', 'standard'], maxTicks: 30 * MIN, timeDecisions: true, trackStuck: false });
    const r = play();
    const again = play();
    expect(again.endTick).toBe(r.endTick);
    for (const [i, s] of r.seats.entries()) {
      const other = again.seats[i]!.decisionMs;
      expect(other.length).toBe(s.decisionMs.length);
      const ops = s.ops!;
      const avgOps = ops.total / ops.decisions;
      const ms = s.decisionMs.map((x, k) => Math.min(x, other[k]!)).sort((x, y) => x - y);
      const avgMs = ms.reduce((t, x) => t + x, 0) / ms.length;
      const p99 = ms[Math.floor(ms.length * 0.99)]!;
      const perTick = (avgMs * ms.length) / r.endTick;
      console.info(
        `[ai] cost ${s.seat}: ${ops.decisions} decisions, ops avg ${Math.round(avgOps)} max ${ops.max}; ` +
          `ms (best of 2 per decision) avg ${avgMs.toFixed(3)} p99 ${p99.toFixed(3)} max ${ms[ms.length - 1]!.toFixed(3)}; amortised ${perTick.toFixed(4)} ms/tick; army ${s.army}`,
      );
      // Operation budget (deterministic): see DESIGN.md "WP26".
      expect(avgOps).toBeLessThan(AI_OPS_AVG);
      expect(ops.max).toBeLessThan(AI_OPS_MAX);
      // Time: 6.7 asks for 3 ms average, 8 ms worst case and 0.5 ms per tick at standard. Wall-clock time on the
      // shared, heavily loaded test machine is a smoke check only (5x headroom, worst case on the 99th percentile so
      // GC pauses and preemption do not count); the operation budget above is the real, deterministic gate.
      expect(avgMs).toBeLessThan(15);
      expect(p99).toBeLessThan(80);
      if (s.seat === 'standard') expect(perTick).toBeLessThan(2.5);
    }
  }, SLOW);
});

/** Operation budgets per decision (entities read, candidates scored, grid cells visited, site candidates). */
export const AI_OPS_AVG = 40_000;
export const AI_OPS_MAX = 120_000;
