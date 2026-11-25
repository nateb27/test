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
 * `scripts/` holds the browser-side measurements; this file is sim only.
 */

import { describe, expect, it } from 'vitest';
import { hashState } from '../../src/sim';
import { createStressScenario, STRESS_BUILDINGS, STRESS_UNITS } from '../../src/sim/stress';

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

  it('averages well under 4 ms per tick and has no tick near 12 ms for long', () => {
    const sc = createStressScenario(1);
    const step = (): number => {
      const commands = sc.commands(sc.sim.state.tick);
      const t0 = performance.now();
      sc.sim.step(commands);
      return performance.now() - t0;
    };
    const cold: number[] = [];
    for (let i = 0; i < WARMUP; i++) cold.push(step());
    const times: number[] = [];
    for (let i = 0; i < MEASURED; i++) times.push(step());
    const sorted = [...times].sort((a, b) => a - b);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const p99 = sorted[Math.floor(times.length * 0.99)] as number;
    const max = sorted[sorted.length - 1] as number;
    console.log(
      `stress tick (${MEASURED} ticks after ${WARMUP} warm-up): avg ${avg.toFixed(2)} ms, p99 ${p99.toFixed(2)} ms, ` +
        `max ${max.toFixed(2)} ms; first ticks (cold, 200 path requests at once) max ${Math.max(...cold).toFixed(1)} ms`,
    );
    expect(avg).toBeLessThan(2); // budget 4 ms; measured ~0.3 ms
    expect(p99).toBeLessThan(12); // budget: worst tick 12 ms
    expect(max).toBeLessThan(60); // an isolated GC pause or a loaded machine is tolerated, a regression is not
    // The match is really busy: nobody has run out of work.
    const idle = sc.sim.state.entities.filter((e) => e.kind === 'unit' && e.currentOrder === null).length;
    expect(idle).toBeLessThan(STRESS_UNITS / 4);
  }, 60_000);
});
