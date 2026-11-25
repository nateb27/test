/**
 * Economy bot acceptance (plan 5.7, 9.1): the scripted bot, using only the public sim API, reaches the pacing
 * targets on five seeds without anything getting stuck. Each seed is played once to the Empire Age and the
 * assertions share that run. Per-seed timings are printed so the balance report can quote them.
 */

import { describe, expect, it } from 'vitest';
import { hashState } from '../../src/sim';
import { TICK_RATE } from '../../src/sim/types';
import { fmtTime, playBot, type BotRun } from './botHarness';

/** Plan 5.7 thresholds in game seconds (never edit these to make the bot pass; tune the data instead). */
const TARGETS = { 2: 6.5 * 60, 3: 14 * 60, 4: 24 * 60 } as const;
const SEEDS = [1, 2, 3, 4, 5];
/** One bot match to the Empire Age takes a few seconds of CPU. */
const SLOW = 60_000;

const runs = new Map<number, BotRun>();
function run(seed: number): BotRun {
  let r = runs.get(seed);
  if (r === undefined) {
    r = playBot(seed);
    runs.set(seed, r);
  }
  return r;
}

describe('economy bot (real data, public API only)', () => {
  describe.each(SEEDS)('seed %i', (seed) => {
    it('reaches Township, Citadel and Empire Age within the pacing targets', () => {
      const r = run(seed);
      const t = r.ageSeconds;
      console.info(
        `[bot] seed ${seed}: Township ${fmtTime(t[2])}, Citadel ${fmtTime(t[3])}, Empire ${fmtTime(t[4])} ` +
          `(targets 6:30, 14:00, 24:00); ${r.bot.decisions} decisions, ${r.log.size} command batches`,
      );
      expect(t[2], 'Township Age reached').toBeDefined();
      expect(t[2]!).toBeLessThanOrEqual(TARGETS[2]);
      expect(t[3], 'Citadel Age reached').toBeDefined();
      expect(t[3]!).toBeLessThanOrEqual(TARGETS[3]);
      expect(t[4], 'Empire Age reached').toBeDefined();
      expect(t[4]!).toBeLessThanOrEqual(TARGETS[4]);
      expect(r.sim.state.objectives.entries[0]?.completedTick).not.toBeNull();
    }, SLOW);

    it('never leaves a unit stuck for 30 s, never goes negative, never issues a rejected command', () => {
      const r = run(seed);
      expect(r.stuck, 'units that wanted to move but did not for 30 s').toEqual([]);
      expect(r.negativeResource).toBeNull();
      expect(r.rejections).toEqual([]);
      expect(r.violations).toEqual([]);
    }, SLOW);
  });

  it('plays like a human: decisions once a second, villagers rarely idle for long', () => {
    const r = run(SEEDS[0]!);
    const seconds = Math.ceil(r.sim.state.tick / TICK_RATE);
    expect(r.bot.decisions).toBe(seconds);
    // Every command batch lands on a decision tick, never between them.
    for (const tick of r.log.keys()) expect(tick % 20).toBe(0);
    // A villager waiting five seconds in a row for work is a bot failure, not a rounding error.
    expect(r.longIdle.length).toBeLessThanOrEqual(3);
  }, SLOW);

  it('is deterministic: the same seed yields the same commands and the same final state', () => {
    // Replaying only to the Township Age keeps this cheap; the decision code is the same all game.
    const a = playBot(SEEDS[1]!, { untilAge: 2 });
    const b = playBot(SEEDS[1]!, { untilAge: 2 });
    expect(JSON.stringify([...b.log])).toBe(JSON.stringify([...a.log]));
    expect(hashState(b.sim.state)).toBe(hashState(a.sim.state));
  }, SLOW);
});
