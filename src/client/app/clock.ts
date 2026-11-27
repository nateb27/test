/**
 * The client's millisecond clock for time-windowed UI rules (double click, double tap, demolish confirmation,
 * toast and banner lifetimes, order markers). It is `performance.now()` unless a dev or e2e build freezes it through
 * `window.__game.freezeClock()`; a frozen clock moves only through `advance`, so a test that issues two clicks "within
 * the double-click window" does not depend on how fast the machine delivers them.
 */
export class ClientClock {
  private frozen: number | null = null;

  /** Current time in ms. */
  now = (): number => this.frozen ?? performance.now();

  /** Stop following real time; the clock stays where it is now until `advance`. */
  freeze(): void {
    // Whole milliseconds, so `now + window - now` is exact (a fractional start made the window test flaky).
    this.frozen ??= Math.floor(performance.now());
  }

  /** Move a frozen clock forward by `ms`. Throws while the clock is running on real time. */
  advance(ms: number): void {
    if (this.frozen === null) throw new Error('clock is not frozen');
    this.frozen += ms;
  }

  get isFrozen(): boolean {
    return this.frozen !== null;
  }
}
