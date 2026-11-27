/**
 * WP33, `npm run test:long`: the PLAN-M2 8.4 battle at full size (200 soldiers a side plus both bases) against the
 * 1.3 budget, and its determinism.
 *
 * - Budget: ticks 200 to 2,200 (the first 200 are cold start, excluded by plan 1.3), average under 4 ms and p99 under
 *   12 ms. Measured as in `perfHarness.ts`: three runs of the same battle, the average from the best run's thread CPU
 *   time, p99 from the per-tick best wall time, so machine load does not fail it; every run is printed.
 * - Determinism: two runs agree hash for hash every 100 ticks, and so does a run that is saved and loaded every 250
 *   ticks (plan 8.4).
 */

import { describe, expect, it } from 'vitest';
import { registry } from '../../src/data';
import { deserialize, hashState, serialize, type Sim } from '../../src/sim';
import { createBattleScenario } from '../../src/sim/stress';
import { formatReport, measureTicks } from './perfHarness';

const TICKS = 2200;

function battleHashes(saveEvery: number | null): string[] {
  let sim: Sim = createBattleScenario(1, 200);
  const hashes: string[] = [];
  while (sim.state.tick < TICKS) {
    sim.step([]);
    if (saveEvery !== null && sim.state.tick % saveEvery === 0) sim = deserialize(serialize(sim), registry);
    if (sim.state.tick % 100 === 0) hashes.push(hashState(sim.state));
  }
  return hashes;
}

describe('battle scenario at full size (PLAN-M2 8.4)', () => {
  it('ticks 200 to 2,200: average under 4 ms, p99 under 12 ms (best of 3 runs)', async () => {
    const r = await measureTicks(
      () => {
        const sim = createBattleScenario(1, 200);
        return { step: () => void sim.step([]) };
      },
      199,
      2000,
      3,
    );
    console.log(formatReport('battle 200/side, ticks 200-2200', r));
    expect(r.cpuAvg).toBeLessThan(4);
    expect(r.bestWall.p99).toBeLessThan(12);
    // The clash itself (ticks 1 to 700, cold start included) is reported for the record, under the same budget.
    const clash = await measureTicks(
      () => {
        const sim = createBattleScenario(1, 200);
        return { step: () => void sim.step([]) };
      },
      0,
      700,
      3,
    );
    console.log(formatReport('battle 200/side, ticks 1-700 (the clash)', clash));
    expect(clash.cpuAvg).toBeLessThan(4);
    expect(clash.bestWall.p99).toBeLessThan(12);
  }, 600_000);

  it('is deterministic: two runs, and a run saved and loaded every 250 ticks, agree every 100 ticks', () => {
    const a = battleHashes(null);
    expect(a.length).toBe(TICKS / 100);
    expect(battleHashes(null)).toEqual(a);
    expect(battleHashes(250)).toEqual(a);
  }, 600_000);
});
