/**
 * Fixed-tick accumulator (plan 2.3). Pause and speed are client settings,
 * never sim state. Pure logic; the requestAnimationFrame driver is in match.ts.
 */

import { TICK_MS } from '../../sim/types';

export type GameSpeed = 1 | 1.5 | 2;
export const GAME_SPEEDS: readonly GameSpeed[] = [1, 1.5, 2];
/** Cap on ticks per frame so a tab stall does not cause a catch-up spiral. */
export const MAX_TICKS_PER_FRAME = 5;

export interface LoopAdvance {
  /** Ticks to run this frame (0..MAX_TICKS_PER_FRAME). */
  ticks: number;
  /** Interpolation factor in [0, 1) between the previous and current tick. */
  alpha: number;
}

export class FixedTickLoop {
  speed: GameSpeed = 1;
  paused = false;
  private accumulatorMs = 0;

  /** Feed real elapsed milliseconds since the last frame. */
  advance(realDtMs: number): LoopAdvance {
    if (!this.paused && Number.isFinite(realDtMs) && realDtMs > 0) {
      this.accumulatorMs += realDtMs * this.speed;
    }
    let ticks = Math.floor(this.accumulatorMs / TICK_MS);
    if (ticks > MAX_TICKS_PER_FRAME) {
      // Drop the backlog rather than spiral.
      ticks = MAX_TICKS_PER_FRAME;
      this.accumulatorMs = 0;
    } else {
      this.accumulatorMs -= ticks * TICK_MS;
    }
    return { ticks, alpha: Math.min(this.accumulatorMs / TICK_MS, 0.999999) };
  }

  reset(): void {
    this.accumulatorMs = 0;
  }
}
