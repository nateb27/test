/**
 * `npm run test:long` (PLAN-M2 8.1 AI item 4, 11 item 8): the AI timing table on 5 seeds and Hard against Easy.
 * The rest of the ladder is in `aiLadder.long.test.ts` (a separate file so Vitest runs it in parallel).
 *
 * - Township and first-wave windows (5.5) on seeds 1-5, printed for BALANCE.md.
 * - Hard beats Easy on 5 of 5 seeds, each before 35:00.
 *
 * Every match also checks command hygiene (item 5) and the 30 s stuck rule (item 6).
 */

import { describe, expect, it } from 'vitest';
import type { AiDifficulty } from '../../src/sim';
import { TICK_RATE } from '../../src/sim';
import { FIRST_WAVE, LADDER_SEEDS, LONG, TOWNSHIP, fmtTick, ladderMatch, opening } from './aiHarness';

describe('AI timing table (5 seeds, BALANCE.md)', () => {
  const DIFFS: readonly AiDifficulty[] = ['easy', 'standard', 'hard'];
  it.each(DIFFS)('%s: Township and first wave inside the 5.5 windows on seeds 1-5', (diff) => {
    const rows: string[] = [];
    for (const seed of LADDER_SEEDS) {
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

describe('AI ladder: Hard vs Easy', () => {
  it.each(LADDER_SEEDS)('seed %i: Hard beats Easy before 35:00', (seed) => {
    const r = ladderMatch(['hard', 'easy'], seed, 35);
    expect(r.winner).toBe(1);
  }, LONG);
});
