import { describe, expect, it } from 'vitest';
import {
  compareDepth,
  depthKey,
  footprintCenter,
  screenToTile,
  screenToWorld,
  tileDiamond,
  worldToScreen,
} from '../../../src/client/render/iso';

describe('iso projection', () => {
  it('matches the plan formula', () => {
    expect(worldToScreen(0, 0)).toEqual({ x: 0, y: 0 });
    expect(worldToScreen(1, 0)).toEqual({ x: 32, y: 16 });
    expect(worldToScreen(0, 1)).toEqual({ x: -32, y: 16 });
    expect(worldToScreen(3.5, 5.5)).toEqual({ x: -64, y: 144 });
  });

  it('+x runs down-right and +y runs down-left', () => {
    const o = worldToScreen(10, 10);
    const px = worldToScreen(11, 10);
    const py = worldToScreen(10, 11);
    expect(px.x).toBeGreaterThan(o.x);
    expect(px.y).toBeGreaterThan(o.y);
    expect(py.x).toBeLessThan(o.x);
    expect(py.y).toBeGreaterThan(o.y);
  });

  it('round-trips world -> screen -> world', () => {
    const points: [number, number][] = [
      [0, 0],
      [3.5, 5.5],
      [119.99, 0.01],
      [60.25, 60.75],
      [-4, 7.125],
      [1e-3, 118.5],
    ];
    for (const [x, y] of points) {
      const s = worldToScreen(x, y);
      const w = screenToWorld(s.x, s.y);
      expect(w.x).toBeCloseTo(x, 9);
      expect(w.y).toBeCloseTo(y, 9);
    }
  });

  it('round-trips screen -> world -> screen', () => {
    for (let sx = -500; sx <= 500; sx += 137) {
      for (let sy = 0; sy <= 1000; sy += 211) {
        const w = screenToWorld(sx, sy);
        const s = worldToScreen(w.x, w.y);
        expect(s.x).toBeCloseTo(sx, 9);
        expect(s.y).toBeCloseTo(sy, 9);
      }
    }
  });

  it('picks the tile under a screen point', () => {
    const centre = worldToScreen(3.5, 5.5);
    expect(screenToTile(centre.x, centre.y)).toEqual({ tx: 3, ty: 5 });
    // Just inside the top vertex of tile (7, 2).
    const top = worldToScreen(7, 2);
    expect(screenToTile(top.x, top.y + 0.5)).toEqual({ tx: 7, ty: 2 });
  });

  it('computes footprint centres and diamonds', () => {
    expect(footprintCenter(10, 20, 4)).toEqual({ x: 12, y: 22 });
    const [top, right, bottom, left] = tileDiamond(0, 0);
    expect(top).toEqual({ x: 0, y: 0 });
    expect(right).toEqual({ x: 32, y: 16 });
    expect(bottom).toEqual({ x: 0, y: 32 });
    expect(left).toEqual({ x: -32, y: 16 });
  });

  it('orders by x + y, then id', () => {
    expect(depthKey(2, 3)).toBe(5);
    const items = [
      { depth: 5, id: 9 },
      { depth: 4, id: 10 },
      { depth: 5, id: 2 },
    ];
    items.sort(compareDepth);
    expect(items.map((i) => i.id)).toEqual([10, 2, 9]);
  });
});
