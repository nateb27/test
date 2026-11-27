/**
 * Minimap alert pings (PLAN-M2 7.2), timed on the match clock (`state.tick`), never on wall time: pausing the game
 * freezes them and a loaded save drops the ones from its future.
 */

import { TICK_RATE } from '../../../sim/types';

/** One ring expands over 1.5 s. */
export const PING_CYCLE_TICKS = Math.round(1.5 * TICK_RATE);
/** The ring plays twice. */
export const PING_REPEATS = 2;
export const PING_LIFE_TICKS = PING_CYCLE_TICKS * PING_REPEATS;
/** At most this many pings are live; a fifth replaces the oldest. */
export const MAX_PINGS = 4;
/** Default ping colour (red). */
export const PING_COLOR = 0xff4a3a;

export interface Ping {
  /** World tiles. */
  x: number;
  y: number;
  /** `state.tick` when it was added. */
  tick: number;
  color: number;
}

/** Fixed-capacity set of live pings. Adding and pruning never allocate beyond the first four pings. */
export class PingSet {
  private readonly items: Ping[] = [];

  get size(): number {
    return this.items.length;
  }

  at(i: number): Ping {
    return this.items[i]!;
  }

  /** Add a ping at `tick`. A second ping at the same place on the same tick (two reports of one alert) is ignored. */
  add(x: number, y: number, color: number, tick: number): void {
    for (const p of this.items) {
      if (p.tick === tick && Math.abs(p.x - x) < 0.5 && Math.abs(p.y - y) < 0.5) return;
    }
    if (this.items.length >= MAX_PINGS) this.items.shift();
    this.items.push({ x, y, tick, color });
  }

  /** Drop pings that finished, or that lie in the future of `tick` (after loading an earlier save). */
  prune(tick: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const age = tick - this.items[i]!.tick;
      if (age < 0 || age >= PING_LIFE_TICKS) this.items.splice(i, 1);
    }
  }

  clear(): void {
    this.items.length = 0;
  }
}

/** Ring look at `age` ticks: radius fraction in [0, 1) of the cycle and the fade. */
export function pingLook(age: number): { t: number; alpha: number } {
  const t = (age % PING_CYCLE_TICKS) / PING_CYCLE_TICKS;
  return { t, alpha: 1 - t * t };
}
