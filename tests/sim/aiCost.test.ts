/**
 * AI decision cost (PLAN-M2 6.7, 8.1 item 8): a 200-unit army must cost under 3 ms a decision on average and under
 * 8 ms in the worst case, and under 0.5 ms a tick amortised at standard.
 *
 * - Operation counts are the hard, deterministic check. A decision counts every entity it reads, every candidate it
 *   scores, every grid cell and footprint tile it tests and every sim query it makes (each availability check and
 *   `canPlace` scans the state, so it counts as many operations as there are entities). AI_OPS_MAX is the 8 ms budget
 *   in operations with a wide margin: measured warm, a decision costs about 10 to 30 ns per counted operation.
 * - Times are checked load-robustly: the match is deterministic, so it is played three times (after a short warm-up
 *   match, so JIT compilation is not counted) and every decision counts with its fastest run. Machine load or a
 *   garbage collection slows one run's decision, not the same decision in all three, while a really slow decision is
 *   slow in all of them (the approach of tests/sim/perfHarness.ts).
 */

import { describe, expect, it } from 'vitest';
import { AiPlayer } from '../../src/bot';
import type { AiDifficulty, Command } from '../../src/sim';
import { createBattleScenario } from '../../src/sim/stress';
import { MIN, playMatch } from './aiHarness';

/** Operation budgets per decision (PLAN-M2 6.7 in operations; see the file comment). */
export const AI_OPS_AVG = 60_000;
export const AI_OPS_MAX = 250_000;

describe('AI decision cost (6.7, 8.1 item 8)', () => {
  it('Hard vs Standard, seed 2, 40 minutes: every decision inside the operation budget and the 6.7 times', () => {
    playMatch({ seed: 3, seats: ['hard', 'standard'], maxTicks: 3 * MIN, timeDecisions: true, trackStuck: false });
    const play = () => playMatch({ seed: 2, seats: ['hard', 'standard'], maxTicks: 40 * MIN, timeDecisions: true, trackStuck: false, timelineEvery: MIN });
    const runs = [play(), play(), play()];
    const r = runs[0]!;
    for (const other of runs) expect(other.endTick).toBe(r.endTick);
    let largestArmy = 0;
    for (const s of r.seats) for (const row of s.timeline) largestArmy = Math.max(largestArmy, row.army);
    const together = Math.max(...r.seats[0]!.timeline.map((row, k) => row.army + r.seats[1]!.timeline[k]!.army));
    console.info(`[ai] cost: largest army ${largestArmy}, both armies together at most ${together}`);
    for (const [i, s] of r.seats.entries()) {
      const ops = s.ops!;
      const avgOps = ops.total / ops.decisions;
      const n = s.decisionMs.length;
      for (const other of runs) expect(other.seats[i]!.decisionMs.length).toBe(n);
      const ms = s.decisionMs.map((_, k) => Math.min(...runs.map((x) => x.seats[i]!.decisionMs[k]!)));
      const avgMs = ms.reduce((t, x) => t + x, 0) / n;
      const maxMs = Math.max(...ms);
      const perTick = (avgMs * n) / r.endTick;
      console.info(
        `[ai] cost ${s.seat}: ${ops.decisions} decisions, ops avg ${Math.round(avgOps)} max ${ops.max}; ` +
          `ms (best of 3) avg ${avgMs.toFixed(3)} max ${maxMs.toFixed(3)}; amortised ${perTick.toFixed(4)} ms/tick; largest army ${Math.max(...s.timeline.map((row) => row.army))}`,
      );
      // Deterministic gate.
      expect(avgOps).toBeLessThan(AI_OPS_AVG);
      expect(ops.max).toBeLessThan(AI_OPS_MAX);
      // The plan's numbers, measured as above.
      expect(avgMs).toBeLessThan(3);
      expect(maxMs).toBeLessThan(8);
      if (s.seat === 'standard') expect(perTick).toBeLessThan(0.5);
    }
    expect(largestArmy).toBeGreaterThan(50);
  }, 1_800_000);

  it('the plan 8.4 battle (200 units a side, both bases) commanded by Hard and Standard: the same budgets', () => {
    const TICKS = 2400;
    const play = () => {
      const sim = createBattleScenario(1, 200);
      const ais = (['hard', 'standard'] as AiDifficulty[]).map((d, i) => AiPlayer.create(i + 1, d, 1));
      const ms: number[][] = [[], []];
      let army = 0;
      for (let t = 0; t < TICKS && sim.state.match.endedTick === null; t++) {
        const cmds: Command[] = [];
        ais.forEach((ai, i) => {
          const due = ai.isDecisionTick(sim.state.tick);
          const t0 = performance.now();
          cmds.push(...ai.update(sim));
          if (due) ms[i]!.push(performance.now() - t0);
        });
        if (t === 0) for (const e of sim.state.entities) if (e.kind === 'unit' && e.typeId !== 'villager') army++;
        sim.step(cmds);
      }
      return { ms, ais, army };
    };
    play();
    const runs = [play(), play(), play()];
    expect(runs[0]!.army).toBeGreaterThanOrEqual(400);
    for (let i = 0; i < 2; i++) {
      const ai = runs[0]!.ais[i]!;
      const n = runs[0]!.ms[i]!.length;
      for (const x of runs) expect(x.ms[i]!.length).toBe(n);
      const ms = runs[0]!.ms[i]!.map((_, k) => Math.min(...runs.map((x) => x.ms[i]![k]!)));
      const avgMs = ms.reduce((t, x) => t + x, 0) / n;
      const maxMs = Math.max(...ms);
      console.info(
        `[ai] battle ${ai.difficulty}: ${n} decisions, ops avg ${Math.round(ai.cost.totalOps / ai.cost.decisions)} max ${ai.cost.maxOps}; ` +
          `ms (best of 3) avg ${avgMs.toFixed(3)} max ${maxMs.toFixed(3)}`,
      );
      expect(ai.cost.totalOps / ai.cost.decisions).toBeLessThan(AI_OPS_AVG);
      expect(ai.cost.maxOps).toBeLessThan(AI_OPS_MAX);
      expect(avgMs).toBeLessThan(3);
      expect(maxMs).toBeLessThan(8);
    }
  }, 1_800_000);
});
