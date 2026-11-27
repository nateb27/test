/**
 * `npm run test:long` (PLAN-M2 8.1, AI item 4): the AI ladder and the 5-seed timing table.
 *
 * - Hard vs Easy and Standard vs Easy on 3 seeds: the stronger AI wins before 35:00 / 45:00.
 * - Hard vs Standard on 3 seeds: Hard wins at least 2 of 3.
 * - Standard vs Standard on 2 seeds: a winner before 75:00 (90,000 ticks).
 * - Township and first-wave windows (5.5) on 5 seeds, printed for BALANCE.md.
 *
 * Every match also checks command hygiene (item 5) and the 30 s stuck rule (item 6).
 */

import { describe, expect, it } from 'vitest';
import type { AiDifficulty } from '../../src/sim';
import { TICK_RATE } from '../../src/sim';
import { FIRST_WAVE, TOWNSHIP, expectHygiene, fmtTick, opening, playMatch, MIN, type Seat } from './aiHarness';

const LONG = 3_600_000;

function ladder(seats: [Seat, Seat], seed: number, limitMin: number) {
  const r = playMatch({ seed, seats, maxTicks: limitMin * MIN });
  console.info(
    `[ai] ${seats[0]} vs ${seats[1]} seed ${seed}: winner ${r.winner ?? 'none'} at ${fmtTick(r.endTick)} ` +
      `(armies ${r.seats[0]!.army}/${r.seats[1]!.army}, villagers ${r.seats[0]!.villagers}/${r.seats[1]!.villagers})`,
  );
  for (const s of r.seats) {
    expectHygiene(s);
    expect(s.stuck, `player ${s.playerId} stuck units`).toEqual([]);
  }
  return r;
}

describe('AI ladder', () => {
  describe.each([1, 2, 3])('seed %i', (seed) => {
    it('Hard beats Easy before 35:00', () => {
      const r = ladder(['hard', 'easy'], seed, 35);
      expect(r.winner).toBe(1);
    }, LONG);

    it('Standard beats Easy before 45:00', () => {
      const r = ladder(['standard', 'easy'], seed, 45);
      expect(r.winner).toBe(1);
    }, LONG);
  });

  it('Hard beats Standard in at least 2 of 3 seeds', () => {
    let wins = 0;
    for (const seed of [1, 2, 3]) {
      const r = ladder(['hard', 'standard'], seed, 75);
      if (r.winner === 1) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(2);
  }, LONG);

  it.each([1, 2])('Standard vs Standard, seed %i: a winner before 75:00', (seed) => {
    const r = ladder(['standard', 'standard'], seed, 75);
    expect(r.winner).not.toBeNull();
  }, LONG);
});

describe('AI timing table (5 seeds, BALANCE.md)', () => {
  const DIFFS: readonly AiDifficulty[] = ['easy', 'standard', 'hard'];
  it.each(DIFFS)('%s: Township and first wave inside the 5.5 windows on seeds 1-5', (diff) => {
    const rows: string[] = [];
    for (const seed of [1, 2, 3, 4, 5]) {
      const s = opening(diff, seed).seats[0]!;
      rows.push(`seed ${seed} Township ${fmtTick(s.ageTicks[1])} wave ${fmtTick(s.firstWaveTick)}`);
      expect(s.ageTicks[1]! / TICK_RATE).toBeGreaterThanOrEqual(TOWNSHIP[diff][0]);
      expect(s.ageTicks[1]! / TICK_RATE).toBeLessThanOrEqual(TOWNSHIP[diff][1]);
      expect(s.firstWaveTick! / TICK_RATE).toBeGreaterThanOrEqual(FIRST_WAVE[diff][0]);
      expect(s.firstWaveTick! / TICK_RATE).toBeLessThanOrEqual(FIRST_WAVE[diff][1]);
      expect(s.stuck).toEqual([]);
    }
    console.info(`[ai] ${diff}: ${rows.join('; ')}`);
  }, LONG);
});
