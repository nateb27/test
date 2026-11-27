/**
 * The player's frame-rate readout (verification fix D4): frames per second and the sim's cost per tick, so the owner
 * can report the frame rate on real hardware (PLAN-M2 8.4 asks for 60 fps at 1x on the battle scene; the container
 * has no GPU). Works in every build, production included: toggled with F3, or shown from the start with `?fps=1`.
 *
 * Client only: it reads wall-clock time (never the sim's), is never saved and changes nothing in the game.
 */

import { FrameProfiler } from '../debug/profiler';

/** How often the text is refreshed (ms of wall time). */
const REFRESH_MS = 500;

/** Readout text: "60 fps | sim 0.42 ms/tick (max 1.8)". Pure, for tests. */
export function fpsText(fps: number, tickAvgMs: number, tickMaxMs: number): string {
  return `${Math.round(fps)} fps | sim ${tickAvgMs.toFixed(2)} ms/tick (max ${tickMaxMs.toFixed(1)})`;
}

/** Is the readout asked for in the page URL (`?fps=1`, or `?fps` alone)? */
export function fpsFromUrl(search: string): boolean {
  const v = new URLSearchParams(search).get('fps');
  return v !== null && v !== '0' && v !== 'false';
}

export class FpsMeter {
  /** Fed by the match while visible (frames and sim ticks). */
  readonly profiler = new FrameProfiler();
  private readonly el: HTMLDivElement;
  private lastRefresh = 0;
  private shown = false;

  constructor(parent: HTMLElement, visible: boolean) {
    this.el = document.createElement('div');
    this.el.className = 'fps-meter';
    this.el.dataset.testid = 'fps-meter';
    this.el.setAttribute('aria-live', 'off');
    parent.appendChild(this.el);
    this.setVisible(visible);
  }

  get visible(): boolean {
    return this.shown;
  }

  setVisible(on: boolean): void {
    this.shown = on;
    this.el.hidden = !on;
    this.profiler.reset();
    this.lastRefresh = 0;
    if (on) this.el.textContent = fpsText(0, 0, 0);
  }

  toggle(): void {
    this.setVisible(!this.shown);
  }

  /** Called once per animation frame with the frame's timestamp; refreshes the text twice a second. */
  frame(nowMs: number): void {
    if (!this.shown || nowMs - this.lastRefresh < REFRESH_MS) return;
    this.lastRefresh = nowMs;
    const s = this.profiler.snapshot();
    this.el.textContent = fpsText(s.fps, s.tickAvgMs, s.tickMaxMs);
  }

  destroy(): void {
    this.el.remove();
  }
}
