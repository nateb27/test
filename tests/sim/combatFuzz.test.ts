/**
 * WP33 combat fuzz, bounded for `npm test`: a few seeds of random valid commands on a small two-base map, invariants
 * checked every tick (see `combatFuzz.ts`), plus determinism (two runs, and a save/load at a seeded tick). The full
 * sweep (50 seeds x 4,000 ticks) is `combatFuzz.long.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { createRng, rngInt } from '../../src/sim/rng';
import { runFuzz } from './combatFuzz';

describe('combat fuzz (bounded)', () => {
  it.each([1, 2, 3, 4])('seed %i: 2,000 ticks of random orders break no invariant', (seed) => {
    const r = runFuzz(seed, { ticks: 2000 });
    expect(r.violations).toEqual([]);
    expect(r.deaths, 'the fight happened').toBeGreaterThan(5);
  });

  it('is deterministic: two runs, and a run with a save/load at a seeded tick, give the same hashes', () => {
    const seed = 5;
    const a = runFuzz(seed, { ticks: 1500, check: false });
    const b = runFuzz(seed, { ticks: 1500, check: false });
    expect(b.hashes).toEqual(a.hashes);
    const at = 100 + rngInt(createRng(seed), 1300);
    const c = runFuzz(seed, { ticks: 1500, check: false, saveLoadAt: at });
    expect(c.hashes).toEqual(a.hashes);
  });
});
