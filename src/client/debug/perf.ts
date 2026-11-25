/**
 * Frame-cost instrumentation for dev and e2e builds (WP12). Off unless a
 * script turns it on through `window.__game.perf`; when off, `start` and
 * `end` are a branch and a return, so production code paths pay nothing
 * measurable. Never read by game logic.
 */

export interface PerfSample {
  /** Number of timed sections. */
  count: number;
  totalMs: number;
  maxMs: number;
}

export interface PerfSnapshotEntry extends PerfSample {
  avgMs: number;
}

class PerfCollector {
  enabled = false;
  private readonly samples = new Map<string, PerfSample>();

  /** Timestamp to pass to `end`, or 0 while collection is off. */
  start(): number {
    return this.enabled ? performance.now() : 0;
  }

  /** Record the time since `t0` (from `start`) under `name`. */
  end(name: string, t0: number): void {
    if (!this.enabled || t0 === 0) return;
    this.add(name, performance.now() - t0);
  }

  add(name: string, ms: number): void {
    if (!this.enabled) return;
    let s = this.samples.get(name);
    if (s === undefined) {
      s = { count: 0, totalMs: 0, maxMs: 0 };
      this.samples.set(name, s);
    }
    s.count++;
    s.totalMs += ms;
    if (ms > s.maxMs) s.maxMs = ms;
  }

  reset(): void {
    this.samples.clear();
  }

  snapshot(): Record<string, PerfSnapshotEntry> {
    const out: Record<string, PerfSnapshotEntry> = {};
    for (const [name, s] of this.samples) out[name] = { ...s, avgMs: s.count === 0 ? 0 : s.totalMs / s.count };
    return out;
  }
}

/** The shared collector. */
export const perf = new PerfCollector();
