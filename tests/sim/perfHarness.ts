/**
 * Tick-time measurement that a noisy neighbour disturbs less (WP33).
 *
 * The same deterministic scenario is run `repeats` times.
 *
 * - **Average:** the CPU time this thread spent over the measured ticks (`process.threadCpuUsage`, which does not
 *   advance while another process has the core), divided by the tick count; the lowest of the runs counts. The CPU
 *   clock ticks in steps of a few milliseconds, so it is only read around the whole window, never per tick.
 * - **Per-tick distribution (p99, max):** wall clock per tick; for every tick index the fastest of the runs is kept.
 *   A spike caused by machine load hits one run, not the same tick of every run, while a real hot tick (a path burst,
 *   the big clash) is slow in every run and survives.
 *
 * Every run's own wall-clock numbers are reported next to the combined ones, with the load average.
 */

export interface TickStats {
  avg: number;
  median: number;
  p99: number;
  max: number;
}

export interface PerfReport {
  /** Lowest per-run average of thread CPU time per tick (ms). */
  cpuAvg: number;
  /** Per-run averages of thread CPU time per tick (ms). */
  runsCpuAvg: number[];
  /** Per-tick best of the runs, wall clock (ms): the budgets' p99 comes from here. */
  bestWall: TickStats;
  /** Each run on its own, wall clock (ms). */
  runsWall: TickStats[];
  /** Load average (1 min) when the measurement started and ended. */
  load: [number, number];
}

export interface Steppable {
  step(): void;
}

function stats(times: readonly number[]): TickStats {
  const sorted = [...times].sort((a, b) => a - b);
  const avg = times.reduce((a, b) => a + b, 0) / Math.max(1, times.length);
  return {
    avg,
    median: sorted[Math.floor(sorted.length / 2)] ?? 0,
    p99: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
  };
}

type CpuUsage = { user: number; system: number };
const proc = process as unknown as { threadCpuUsage?: () => CpuUsage };
const threadCpu: () => CpuUsage = proc.threadCpuUsage !== undefined ? () => proc.threadCpuUsage!() : () => process.cpuUsage();

async function loadAverage(): Promise<number> {
  const os = await import('node:os');
  return os.loadavg()[0] ?? 0;
}

/** Run `make()` `repeats` times; skip `warm` ticks, time `measured` ticks. */
export async function measureTicks(make: () => Steppable, warm: number, measured: number, repeats = 3): Promise<PerfReport> {
  const load0 = await loadAverage();
  const wallRuns: number[][] = [];
  const cpuAvgs: number[] = [];
  for (let r = 0; r < repeats; r++) {
    const sc = make();
    for (let i = 0; i < warm; i++) sc.step();
    const wall: number[] = [];
    const c0 = threadCpu();
    for (let i = 0; i < measured; i++) {
      const t0 = performance.now();
      sc.step();
      wall.push(performance.now() - t0);
    }
    const c1 = threadCpu();
    cpuAvgs.push((c1.user - c0.user + c1.system - c0.system) / 1000 / measured);
    wallRuns.push(wall);
  }
  const best = wallRuns[0]!.map((_, i) => Math.min(...wallRuns.map((run) => run[i]!)));
  return {
    cpuAvg: Math.min(...cpuAvgs),
    runsCpuAvg: cpuAvgs,
    bestWall: stats(best),
    runsWall: wallRuns.map(stats),
    load: [load0, await loadAverage()],
  };
}

const f = (s: TickStats): string => `avg ${s.avg.toFixed(3)} median ${s.median.toFixed(3)} p99 ${s.p99.toFixed(2)} max ${s.max.toFixed(2)}`;

export function formatReport(name: string, r: PerfReport): string {
  return [
    `${name} (load ${r.load[0].toFixed(1)} -> ${r.load[1].toFixed(1)})`,
    `  cpu avg per tick, best of ${r.runsWall.length}: ${r.cpuAvg.toFixed(3)} ms (runs ${r.runsCpuAvg.map((v) => v.toFixed(3)).join(', ')})`,
    `  wall per tick, best of ${r.runsWall.length} per tick: ${f(r.bestWall)}`,
    ...r.runsWall.map((s, i) => `  run ${i + 1} wall: ${f(s)}`),
  ].join('\n');
}
