import { describe, expect, it } from 'vitest';
import { createRng, rngFloat, rngInt, rngNextUint32, rngShuffle } from '../../../src/sim/rng';

describe('rng', () => {
  it('is deterministic for a seed', () => {
    const a = createRng(12345);
    const b = createRng(12345);
    const seqA = Array.from({ length: 1000 }, () => rngNextUint32(a));
    const seqB = Array.from({ length: 1000 }, () => rngNextUint32(b));
    expect(seqA).toEqual(seqB);
  });

  it('produces a stable known sequence (engine independence guard)', () => {
    const rng = createRng(42);
    const first = Array.from({ length: 4 }, () => rngNextUint32(rng));
    expect(first).toEqual([2852766471, 4136168353, 1126838629, 1262802217]);
  });

  it('differs between seeds', () => {
    const a = createRng(1);
    const b = createRng(2);
    expect(rngNextUint32(a)).not.toBe(rngNextUint32(b));
  });

  it('keeps state as plain uint32 numbers that survive JSON', () => {
    const rng = createRng(7);
    for (let i = 0; i < 100; i++) rngNextUint32(rng);
    for (const v of Object.values(rng)) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(2 ** 32);
    }
    const copy = JSON.parse(JSON.stringify(rng)) as typeof rng;
    expect(rngNextUint32(copy)).toBe(rngNextUint32(rng));
  });

  it('returns values in range', () => {
    const rng = createRng(99);
    for (let i = 0; i < 10_000; i++) {
      const f = rngFloat(rng);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      const n = rngInt(rng, 6);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(6);
    }
  });

  it('shuffles deterministically', () => {
    const a = rngShuffle(createRng(5), [1, 2, 3, 4, 5, 6, 7, 8]);
    const b = rngShuffle(createRng(5), [1, 2, 3, 4, 5, 6, 7, 8]);
    expect(a).toEqual(b);
    expect([...a].sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
