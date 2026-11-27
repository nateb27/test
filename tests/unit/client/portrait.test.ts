/**
 * Portrait crop of foot units (verification fix D8): a Spearman's portrait is his head and torso, not the spear shaft
 * that sticks out above his head.
 */

import { describe, expect, it } from 'vitest';
import { bustBox } from '../../../src/client/art/sheet/manifest';

/** A w x h RGBA image with the given opaque rectangles. */
function figure(w: number, h: number, rects: [number, number, number, number][]): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (const [x, y, rw, rh] of rects) {
    for (let r = y; r < y + rh; r++) for (let c = x; c < x + rw; c++) d[(r * w + c) * 4 + 3] = 255;
  }
  return d;
}

describe('bustBox', () => {
  // 40 x 100: a 2 px spear shaft from the top (rows 0-29) at column 30, a head (rows 30-41, 10 wide), a torso
  // (rows 42-69, 20 wide), legs (rows 70-99, 12 wide), and the shaft carried on across the chest diagonal-free.
  const spearman = figure(40, 100, [
    [30, 0, 2, 70],
    [15, 30, 10, 12],
    [10, 42, 20, 28],
    [14, 70, 12, 30],
  ]);

  it('starts at the head, not at the spear tip, and keeps head and torso', () => {
    const b = bustBox(spearman, 40, 100);
    expect(b.y).toBeGreaterThanOrEqual(28);
    expect(b.y).toBeLessThanOrEqual(30);
    // 60% of the body (rows 29-99) from the head: down through the torso.
    expect(b.y + b.h).toBeGreaterThanOrEqual(70);
    // The head and torso columns are inside; the box is only as wide as the body (the shaft at 30-31 runs down the
    // whole bust, so it counts) or 0.8 of its height, whichever is wider, so the head is not squeezed.
    expect(b.x).toBeLessThanOrEqual(10);
    expect(b.x + b.w).toBeGreaterThanOrEqual(30);
    expect(b.w).toBe(Math.max(22, Math.round(0.8 * b.h)));
  });

  it('a figure without a weapon is cropped to its top 60% as before', () => {
    const plain = figure(30, 50, [
      [10, 0, 10, 10],
      [5, 10, 20, 40],
    ]);
    const b = bustBox(plain, 30, 50);
    expect(b.y).toBe(0);
    expect(b.h).toBe(30);
  });

  it('an empty image is returned whole', () => {
    expect(bustBox(new Uint8ClampedArray(10 * 10 * 4), 10, 10)).toEqual({ x: 0, y: 0, w: 10, h: 10 });
  });
});
