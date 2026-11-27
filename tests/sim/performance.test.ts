/**
 * WP12: sim performance against plan 9.4, as a regression guard.
 *
 * The stress scenario (src/sim/stress.ts) has 200 villagers, 150 buildings and
 * about 1,830 resource nodes, all gathering and walking, plus a scripted
 * player re-tasking a tenth of them every 25 ticks. The budget is an average
 * tick under 4 ms and a worst tick under 12 ms on a mid-range laptop.
 *
 * Wall-clock tests can flake on a loaded CI machine, so the thresholds are
 * deliberately generous (the measured average at the time of writing is about
 * 0.3 ms and the post-warm-up worst about 8 ms): they catch a return to the
 * old behaviour (per-tick scans, allocation storms, a slow A*), not noise.
 * WP33: each timing runs the same deterministic scenario three times and
 * checks the average on the thread's CPU time (best run) and p99/max on the
 * per-tick best wall time (`perfHarness.ts`), so a busy neighbour no longer
 * fails it. The 8.4 battle has a smoke budget here (100 a side, 400 ticks);
 * the full 200-a-side run is `performance.long.test.ts`.
 * `scripts/` holds the browser-side measurements; this file is sim only.
 */

import { describe, expect, it } from 'vitest';
import { hashState } from '../../src/sim';
import { BATTLE_MIX, createBattleScenario, createStressScenario, STRESS_BUILDINGS, STRESS_UNITS } from '../../src/sim/stress';
import { formatReport, measureTicks } from './perfHarness';

const WARMUP = 150;
const MEASURED = 2500;

describe('sim performance (plan 9.4)', () => {
  it('the stress scenario has the planned size', () => {
    const sc = createStressScenario(1);
    const kinds = { unit: 0, building: 0, node: 0 };
    for (const e of sc.sim.state.entities) kinds[e.kind]++;
    expect(kinds.unit).toBe(STRESS_UNITS);
    expect(kinds.building).toBe(STRESS_BUILDINGS);
    expect(kinds.node).toBeGreaterThan(1600);
    expect(kinds.node).toBeLessThan(2000);
  });

  it('is repeatable: the same stress match twice gives the same hashes', () => {
    const run = (): string[] => {
      const sc = createStressScenario(2);
      const out: string[] = [];
      for (let i = 1; i <= 600; i++) {
        sc.sim.step(sc.commands(sc.sim.state.tick));
        if (i % 200 === 0) out.push(hashState(sc.sim.state));
      }
      return out;
    };
    expect(run()).toEqual(run());
  });

  it('averages well under 4 ms per tick and has no tick near 12 ms for long (best of 3 runs)', async () => {
    let last: ReturnType<typeof createStressScenario> | null = null;
    const r = await measureTicks(
      () => {
        const sc = createStressScenario(1);
        last = sc;
        return { step: () => void sc.sim.step(sc.commands(sc.sim.state.tick)) };
      },
      WARMUP,
      MEASURED,
      3,
    );
    console.log(formatReport(`stress tick (${MEASURED} ticks after ${WARMUP} warm-up)`, r));
    expect(r.cpuAvg).toBeLessThan(2); // budget 4 ms; measured ~0.35 ms
    expect(r.bestWall.p99).toBeLessThan(12); // budget: p99 12 ms
    expect(r.bestWall.max).toBeLessThan(60); // an isolated GC pause is tolerated, a regression is not
    // The match is really busy: nobody has run out of work.
    const sc = last as unknown as ReturnType<typeof createStressScenario>;
    const idle = sc.sim.state.entities.filter((e) => e.kind === 'unit' && e.currentOrder === null).length;
    expect(idle).toBeLessThan(STRESS_UNITS / 4);
  }, 120_000);
});

describe('battle scenario (PLAN-M2 8.4), smoke budget for npm test', () => {
  it('has the planned size: 200 soldiers a side in the 8.4 mix (with siege) and 30 extra buildings a side', () => {
    const sim = createBattleScenario(1, 200);
    for (const side of [1, 2]) {
      const units = sim.state.entities.filter((e) => e.kind === 'unit' && e.owner === side && e.typeId !== 'villager');
      expect(units.length).toBe(200);
      for (const { type, per200 } of BATTLE_MIX) expect(units.filter((u) => u.typeId === type).length, type).toBe(per200);
      // Town Center + 30.
      expect(sim.state.entities.filter((e) => e.kind === 'building' && e.owner === side).length).toBe(31);
      const orders = units.map((u) => (u.kind === 'unit' ? (u.currentOrder?.type ?? u.orderQueue[0]?.type) : null));
      expect(new Set(orders)).toEqual(new Set(['attackMove']));
    }
  });

  it('100 a side, ticks 200 to 600: average under 4 ms, p99 under 12 ms (best of 3; the full run is in test:long)', async () => {
    const r = await measureTicks(
      () => {
        const sim = createBattleScenario(1, 100);
        return { step: () => void sim.step([]) };
      },
      199,
      400,
      3,
    );
    console.log(formatReport('battle 100/side, ticks 200-600', r));
    expect(r.cpuAvg).toBeLessThan(4);
    expect(r.bestWall.p99).toBeLessThan(12);
  }, 120_000);
});
