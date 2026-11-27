/**
 * `npm run test:long` (PLAN-M2 8.1 AI item 4, 11 item 8): the AI ladder on 5 seeds. Hard vs Easy and the timing
 * table are in `ai.long.test.ts`.
 *
 * - Standard beats Easy on at least 4 of 5 seeds, each win before 45:00.
 * - Hard beats Standard on at least 4 of 5 seeds; every match has a winner before 75:00 (90,000 ticks).
 * - Mirror matches (Standard vs Standard, Hard vs Hard) on 3 seeds each: a winner before 75:00.
 *
 * Every match also checks command hygiene (item 5) and the 30 s stuck rule (item 6).
 */

import { describe, expect, it } from 'vitest';
import { LADDER_SEEDS, LONG, ladderMatch } from './aiHarness';

describe('AI ladder', () => {
  it('Standard beats Easy on at least 4 of 5 seeds, before 45:00', () => {
    let wins = 0;
    for (const seed of LADDER_SEEDS) if (ladderMatch(['standard', 'easy'], seed, 45).winner === 1) wins++;
    expect(wins).toBeGreaterThanOrEqual(4);
  }, LONG);

  it('Hard beats Standard on at least 4 of 5 seeds; every match ends before 75:00', () => {
    let wins = 0;
    for (const seed of LADDER_SEEDS) {
      const r = ladderMatch(['hard', 'standard'], seed, 75);
      expect(r.winner, `seed ${seed} winner`).not.toBeNull();
      if (r.winner === 1) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(4);
  }, LONG);

  it.each([1, 2, 3])('Standard vs Standard, seed %i: a winner before 75:00', (seed) => {
    expect(ladderMatch(['standard', 'standard'], seed, 75).winner).not.toBeNull();
  }, LONG);

  it.each([1, 2, 3])('Hard vs Hard, seed %i: a winner before 75:00', (seed) => {
    expect(ladderMatch(['hard', 'hard'], seed, 75).winner).not.toBeNull();
  }, LONG);
});
