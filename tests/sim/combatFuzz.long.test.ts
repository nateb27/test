/**
 * WP33 combat fuzz, the big sweep (`npm run test:long`): 50 seeds x 4,000 ticks of random valid commands (attack,
 * attackMove, hold, setStance, repair, move, stop, delete, resign, invalid targets) with deaths, building destruction
 * and defeats, every invariant of `combatFuzz.ts` checked every tick; and for 10 seeds two runs plus a save/load at a
 * seeded random tick compared hash for hash.
 */

import { describe, expect, it } from 'vitest';
import { createRng, rngInt } from '../../src/sim/rng';
import { runFuzz } from './combatFuzz';

const SEEDS = Array.from({ length: 50 }, (_, i) => i + 1);

describe('combat fuzz (50 seeds x 4,000 ticks)', () => {
  it.each(SEEDS)('seed %i breaks no invariant', (seed) => {
    const r = runFuzz(seed, { ticks: 4000 });
    expect(r.violations).toEqual([]);
  });

  it.each(SEEDS.slice(0, 10))('seed %i: two runs and a save/load at a random tick hash the same', (seed) => {
    const a = runFuzz(seed, { ticks: 3000, check: false });
    const b = runFuzz(seed, { ticks: 3000, check: false });
    expect(b.hashes).toEqual(a.hashes);
    const at = 1 + rngInt(createRng(seed * 31), 2998);
    const c = runFuzz(seed, { ticks: 3000, check: false, saveLoadAt: at });
    expect(c.hashes).toEqual(a.hashes);
  });
});
