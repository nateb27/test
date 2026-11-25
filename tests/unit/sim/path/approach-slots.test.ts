import { describe, expect, it } from 'vitest';
import { approachTile, approachTileOnGrid, isAdjacentToFootprint } from '../../../../src/sim/path/approach';
import { componentLabels, isWalkable } from '../../../../src/sim/path/grid';
import { groupSlots } from '../../../../src/sim/path/slots';
import { gridFromAscii, makeCtx, makeState, openGrid, randomGrid } from './helpers';

describe('approach tiles', () => {
  it('returns the adjacent tile nearest to the origin', () => {
    const grid = openGrid(10, 10);
    // 2x2 footprint at (4,4); origin to the left.
    expect(approachTileOnGrid(grid, { x: 0.5, y: 4.9 }, { tx: 4, ty: 4 }, 2)).toEqual({ tx: 3, ty: 4 });
    // Origin below-right: the corner tile.
    expect(approachTileOnGrid(grid, { x: 9.5, y: 9.5 }, { tx: 4, ty: 4 }, 2)).toEqual({ tx: 6, ty: 6 });
  });

  it('breaks distance ties by lowest tile index', () => {
    const grid = openGrid(10, 10);
    // Origin at the centre of a 2x2 footprint: (3,4),(3,5),(6,4)... the four edge-middle pairs tie.
    const t = approachTileOnGrid(grid, { x: 5, y: 5 }, { tx: 4, ty: 4 }, 2);
    expect(t).toEqual({ tx: 4, ty: 3 });
  });

  it('skips blocked and unreachable ring tiles and returns null when none is left', () => {
    const grid = gridFromAscii([
      '.......',
      '.#####.',
      '.#...#.',
      '.#.T.#.',
      '.#...#.',
      '.#####.',
      '.......',
    ]);
    const blocked = grid.blocked as Uint8Array;
    blocked[3 * 7 + 3] = 1; // the target itself at (3,3), size 1
    // From outside the wall: ring tiles are inside the enclosure, unreachable.
    expect(approachTileOnGrid(grid, { x: 0.5, y: 0.5 }, { tx: 3, ty: 3 }, 1)).toBeNull();
    // From inside: reachable.
    expect(approachTileOnGrid(grid, { x: 2.5, y: 2.5 }, { tx: 3, ty: 3 }, 1)).toEqual({ tx: 2, ty: 2 });
    // From a blocked origin (e.g. a building centre), any walkable ring tile counts.
    // Four edge tiles tie at distance 1; lowest tile index wins.
    expect(approachTileOnGrid(grid, { x: 3.5, y: 3.5 }, { tx: 3, ty: 3 }, 1)).toEqual({ tx: 3, ty: 2 });
    // A tree deep in a forest has no approach tile.
    const forest = gridFromAscii(['.....', '.###.', '.###.', '.###.', '.....']);
    expect(approachTileOnGrid(forest, { x: 0.5, y: 0.5 }, { tx: 2, ty: 2 }, 1)).toBeNull();
    expect(approachTileOnGrid(forest, { x: 0.5, y: 0.5 }, { tx: 1, ty: 1 }, 1)).toEqual({ tx: 0, ty: 0 });
  });

  it('works through the sim context and adjacency check', () => {
    const state = makeState(12, 12);
    const occ = new Uint8Array(144);
    for (let y = 5; y < 8; y++) for (let x = 5; x < 8; x++) occ[y * 12 + x] = 1;
    const ctx = makeCtx(state, occ);
    const t = approachTile(ctx, { x: 6.5, y: 0.5 }, { tx: 5, ty: 5 }, 3);
    expect(t).toEqual({ tx: 6, ty: 4 });
    expect(isAdjacentToFootprint({ x: 6.5, y: 4.5 }, { tx: 5, ty: 5 }, 3)).toBe(true);
    expect(isAdjacentToFootprint({ x: 6.5, y: 3.9 }, { tx: 5, ty: 5 }, 3)).toBe(false);
  });
});

describe('group slots', () => {
  it('gives every unit a distinct walkable tile, nearest first', () => {
    const grid = randomGrid(40, 40, 0.2, 5);
    const blocked = grid.blocked as Uint8Array;
    blocked[20 * 40 + 20] = 0;
    const slots = groupSlots(grid, 20.3, 20.6, 60);
    expect(slots).toHaveLength(60);
    expect(slots[0]).toEqual({ x: 20.3, y: 20.6 });
    const labels = componentLabels(grid);
    const seen = new Set<number>();
    let lastD = -1;
    for (const s of slots) {
      const tx = Math.floor(s.x);
      const ty = Math.floor(s.y);
      expect(isWalkable(grid, tx, ty)).toBe(true);
      expect(labels[ty * 40 + tx]).toBe(labels[20 * 40 + 20]);
      const key = ty * 40 + tx;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
      const d = (tx - 20) * (tx - 20) + (ty - 20) * (ty - 20);
      expect(d).toBeGreaterThanOrEqual(lastD);
      lastD = d;
    }
  });

  it('is deterministic and skips a blocked clicked tile', () => {
    const grid = gridFromAscii(['.....', '.....', '..#..', '.....', '.....']);
    const a = groupSlots(grid, 2.5, 2.5, 5);
    const b = groupSlots(grid, 2.5, 2.5, 5);
    expect(a).toEqual(b);
    expect(a).toEqual([
      { x: 2.5, y: 1.5 },
      { x: 1.5, y: 2.5 },
      { x: 3.5, y: 2.5 },
      { x: 2.5, y: 3.5 },
      { x: 1.5, y: 1.5 },
    ]);
  });

  it('does not place slots behind walls and returns fewer when space runs out', () => {
    const grid = gridFromAscii(['..#....', '..#....', '###....']);
    const slots = groupSlots(grid, 0.5, 0.5, 10);
    expect(slots).toHaveLength(4);
    for (const s of slots) expect(s.x).toBeLessThan(2);
  });

  it('clamps points outside the map', () => {
    const grid = openGrid(8, 8);
    const [s] = groupSlots(grid, -5, 20, 1);
    expect(Math.floor(s!.x)).toBe(0);
    expect(Math.floor(s!.y)).toBe(7);
  });
});
