import { describe, expect, it } from 'vitest';
import { FixedTickLoop, MAX_TICKS_PER_FRAME } from '../../../src/client/app/loop';
import { TICK_MS } from '../../../src/sim/types';

describe('FixedTickLoop', () => {
  it('runs one tick per 50 ms at 1x', () => {
    const loop = new FixedTickLoop();
    expect(loop.advance(16).ticks).toBe(0);
    expect(loop.advance(16).ticks).toBe(0);
    expect(loop.advance(20).ticks).toBe(1);
    expect(loop.advance(TICK_MS * 3).ticks).toBe(3);
  });

  it('reports interpolation alpha in [0, 1)', () => {
    const loop = new FixedTickLoop();
    const a = loop.advance(TICK_MS / 2);
    expect(a.ticks).toBe(0);
    expect(a.alpha).toBeCloseTo(0.5);
  });

  it('caps ticks per frame after a stall', () => {
    const loop = new FixedTickLoop();
    expect(loop.advance(10_000).ticks).toBe(MAX_TICKS_PER_FRAME);
    expect(loop.advance(1).ticks).toBe(0);
  });

  it('scales with speed and stops when paused', () => {
    const loop = new FixedTickLoop();
    loop.speed = 2;
    expect(loop.advance(TICK_MS).ticks).toBe(2);
    loop.paused = true;
    expect(loop.advance(TICK_MS * 4).ticks).toBe(0);
    loop.paused = false;
    loop.speed = 1.5;
    expect(loop.advance(TICK_MS * 2).ticks).toBe(3);
  });

  it('ignores invalid frame deltas', () => {
    const loop = new FixedTickLoop();
    expect(loop.advance(Number.NaN).ticks).toBe(0);
    expect(loop.advance(-100).ticks).toBe(0);
  });
});
