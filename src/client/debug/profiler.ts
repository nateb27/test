/**
 * Frame and tick timing for the F3 debug overlay (plan 9.6). Pure bookkeeping:
 * the match feeds it durations only while a profiler is attached, so it costs
 * nothing when the overlay is closed.
 */

import type { ReadonlyGameState } from '../../sim/types';

/** Samples kept (about two seconds of frames, ten of ticks at 20 Hz when not fast-forwarding). */
const WINDOW = 120;

/** Fixed-size window of samples with average and maximum. */
export class RollingStats {
  private readonly samples: number[] = [];
  private next = 0;

  constructor(private readonly size: number = WINDOW) {}

  push(value: number): void {
    if (this.samples.length < this.size) this.samples.push(value);
    else this.samples[this.next] = value;
    this.next = (this.next + 1) % this.size;
  }

  get count(): number {
    return this.samples.length;
  }

  get average(): number {
    if (this.samples.length === 0) return 0;
    let sum = 0;
    for (const s of this.samples) sum += s;
    return sum / this.samples.length;
  }

  get max(): number {
    let m = 0;
    for (const s of this.samples) if (s > m) m = s;
    return m;
  }

  clear(): void {
    this.samples.length = 0;
    this.next = 0;
  }
}

export interface ProfileSnapshot {
  /** Frames per second over the window (0 until two frames were seen). */
  fps: number;
  /** Sim tick wall time in ms: average and worst over the window. */
  tickAvgMs: number;
  tickMaxMs: number;
}

export class FrameProfiler {
  private readonly frames = new RollingStats();
  private readonly ticks = new RollingStats();

  /** Duration of one rendered frame in ms (time since the previous frame). */
  recordFrame(ms: number): void {
    if (ms > 0 && Number.isFinite(ms)) this.frames.push(ms);
  }

  /** Wall time of one `sim.step` in ms. */
  recordTick(ms: number): void {
    if (Number.isFinite(ms)) this.ticks.push(ms);
  }

  snapshot(): ProfileSnapshot {
    const avg = this.frames.average;
    return {
      fps: avg > 0 ? 1000 / avg : 0,
      tickAvgMs: this.ticks.average,
      tickMaxMs: this.ticks.max,
    };
  }

  reset(): void {
    this.frames.clear();
    this.ticks.clear();
  }
}

export interface EntityCounts {
  unit: number;
  building: number;
  node: number;
  total: number;
  /** Count per def id, e.g. `villager`, `house`, `tree`. */
  byType: Record<string, number>;
  pathQueue: number;
}

/** Entity counts by kind and type plus the path queue length. */
export function countEntities(state: ReadonlyGameState): EntityCounts {
  const counts: EntityCounts = { unit: 0, building: 0, node: 0, total: 0, byType: {}, pathQueue: state.pathQueue.length };
  for (const e of state.entities) {
    counts[e.kind] += 1;
    counts.total += 1;
    counts.byType[e.typeId] = (counts.byType[e.typeId] ?? 0) + 1;
  }
  return counts;
}
