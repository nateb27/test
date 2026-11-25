import { describe, expect, it } from 'vitest';
import { ClientClock } from '../../../src/client/app/clock';
import { matchSeed } from '../../../src/client/app/seed';
import { DOUBLE_CLICK_WINDOW_MS, trackClick } from '../../../src/client/input/selection';

describe('ClientClock', () => {
  it('follows real time until frozen, then moves only through advance', () => {
    const clock = new ClientClock();
    const a = clock.now();
    expect(clock.now()).toBeGreaterThanOrEqual(a);
    expect(() => clock.advance(1)).toThrow();
    clock.freeze();
    const t = clock.now();
    expect(clock.isFrozen).toBe(true);
    expect(clock.now()).toBe(t);
    clock.advance(250);
    expect(clock.now()).toBe(t + 250);
    clock.freeze(); // freezing again keeps the time
    expect(clock.now()).toBe(t + 250);
  });

  it('decides the double-click window: the same clicks are a double inside it and two singles outside it', () => {
    const clock = new ClientClock();
    clock.freeze();
    const first = trackClick(null, 7, false, clock.now());
    clock.advance(DOUBLE_CLICK_WINDOW_MS);
    expect(trackClick(first.next, 7, false, clock.now()).isDouble).toBe(true);
    clock.advance(1);
    expect(trackClick(first.next, 7, false, clock.now()).isDouble).toBe(false);
  });
});

describe('matchSeed', () => {
  it('honours ?seed=N where debug hooks are enabled', () => {
    expect(matchSeed('?seed=42', true)).toBe(42);
    expect(matchSeed('?paused=1&seed=0', true)).toBe(0);
    expect(matchSeed('?seed=4294967295', true)).toBe(4294967295);
  });

  it('ignores a missing or malformed seed and always ignores it where hooks are disabled (production)', () => {
    for (const search of ['', '?seed=', '?seed=abc', '?seed=-1', '?seed=1.5', '?seed=4294967296']) {
      const s = matchSeed(search, true);
      expect(Number.isInteger(s) && s >= 0).toBe(true);
    }
    const draws = new Set(Array.from({ length: 8 }, () => matchSeed('?seed=42', false)));
    expect(draws.size).toBeGreaterThan(1);
  });
});
