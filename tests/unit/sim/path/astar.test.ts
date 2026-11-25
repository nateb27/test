import { describe, expect, it } from 'vitest';
import { DIAGONAL_COST, findPath, nearestWalkableTile, STRAIGHT_COST } from '../../../../src/sim/path/astar';
import { canStep, componentLabels, isWalkable, type PathGrid } from '../../../../src/sim/path/grid';
import { NodeHeap } from '../../../../src/sim/path/heap';
import { computePath } from '../../../../src/sim/path/queue';
import { lineWalkable, smoothPath } from '../../../../src/sim/path/smooth';
import { gridFromAscii, openGrid, randomGrid } from './helpers';

/** Reference Dijkstra (O(n^2), test only) with the same moves and costs. */
function referenceCost(grid: PathGrid, sx: number, sy: number, gx: number, gy: number): number | null {
  const n = grid.width * grid.height;
  const dist = new Array<number>(n).fill(Infinity);
  const done = new Array<boolean>(n).fill(false);
  dist[sy * grid.width + sx] = 0;
  for (;;) {
    let cur = -1;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i]! < Infinity && (cur < 0 || dist[i]! < dist[cur]!)) cur = i;
    if (cur < 0) return null;
    if (cur === gy * grid.width + gx) return dist[cur]!;
    done[cur] = true;
    const cx = cur % grid.width;
    const cy = (cur - cx) / grid.width;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        if (!canStep(grid, cx, cy, cx + dx, cy + dy)) continue;
        const ni = (cy + dy) * grid.width + cx + dx;
        const nd = dist[cur]! + (dx !== 0 && dy !== 0 ? DIAGONAL_COST : STRAIGHT_COST);
        if (nd < dist[ni]!) dist[ni] = nd;
      }
  }
}

function xy(grid: PathGrid, i: number): [number, number] {
  const x = i % grid.width;
  return [x, (i - x) / grid.width];
}

/** Validates a raw tile path step by step and returns its cost. */
function pathCost(grid: PathGrid, tiles: number[]): number {
  let cost = 0;
  for (let k = 1; k < tiles.length; k++) {
    const [ax, ay] = xy(grid, tiles[k - 1]!);
    const [bx, by] = xy(grid, tiles[k]!);
    expect(Math.max(Math.abs(ax - bx), Math.abs(ay - by))).toBe(1);
    expect(canStep(grid, ax, ay, bx, by)).toBe(true);
    cost += ax !== bx && ay !== by ? DIAGONAL_COST : STRAIGHT_COST;
  }
  return cost;
}

/** Independent check of a straight segment by dense sampling (tile centres to tile centres). */
function sampledSegmentClear(grid: PathGrid, ax: number, ay: number, bx: number, by: number): boolean {
  const steps = 400;
  for (let s = 0; s <= steps; s++) {
    const x = ax + 0.5 + ((bx - ax) * s) / steps;
    const y = ay + 0.5 + ((by - ay) * s) / steps;
    if (!isWalkable(grid, Math.floor(x), Math.floor(y))) return false;
  }
  return true;
}

describe('NodeHeap', () => {
  it('pops by f, then h, then node index', () => {
    const h = new NodeHeap(2);
    h.push(5, 10, 3);
    h.push(9, 8, 4);
    h.push(2, 10, 3);
    h.push(7, 10, 1);
    h.push(1, 12, 0);
    expect([h.pop(), h.pop(), h.pop(), h.pop(), h.pop()]).toEqual([9, 7, 2, 5, 1]);
    expect(h.size).toBe(0);
  });
});

describe('findPath', () => {
  it('walks straight and diagonally on an open grid with optimal cost', () => {
    const grid = openGrid(10, 10);
    const r = findPath(grid, { tx: 0, ty: 0 }, { kind: 'point', x: 7.5, y: 3.5 });
    expect(r.reached).toBe(true);
    expect(pathCost(grid, r.tiles)).toBe(3 * DIAGONAL_COST + 4 * STRAIGHT_COST);
    expect(r.tiles[r.tiles.length - 1]).toBe(3 * 10 + 7);
  });

  it('solves a maze with the shortest path', () => {
    const grid = gridFromAscii([
      'S.#.......',
      '.##.####.#',
      '.#..#....#',
      '.#.##.##.#',
      '.#....#..G',
      '.####.#.#.',
      '......#...',
    ]);
    const r = findPath(grid, { tx: 0, ty: 0 }, { kind: 'point', x: 9.5, y: 4.5 });
    const ref = referenceCost(grid, 0, 0, 9, 4);
    expect(ref).not.toBeNull();
    expect(r.reached).toBe(true);
    expect(pathCost(grid, r.tiles)).toBe(ref);
    // The maze forces a long detour (straight-line distance is ~10 tiles).
    expect(r.tiles.length).toBeGreaterThan(20);
  });

  it('never cuts corners past blocked tiles', () => {
    // Diagonal neighbours (0,0) -> (1,1) with both orthogonals blocked.
    const grid = gridFromAscii(['.#.', '#..', '...']);
    const r = findPath(grid, { tx: 0, ty: 0 }, { kind: 'point', x: 1.5, y: 1.5 });
    expect(r.reached).toBe(false);
    expect(r.tiles).toEqual([0]);
    // One orthogonal blocked: must go around through the open one.
    const g2 = gridFromAscii(['.#.', '...', '...']);
    const r2 = findPath(g2, { tx: 0, ty: 0 }, { kind: 'point', x: 1.5, y: 1.5 });
    expect(r2.reached).toBe(true);
    expect(r2.tiles).toEqual([0, 3, 4]);
    // Around a single pillar the path takes two straight steps, not a diagonal past its corner.
    const g3 = gridFromAscii(['...', '.#.', '...']);
    const r3 = findPath(g3, { tx: 0, ty: 1 }, { kind: 'point', x: 1.5, y: 0.5 });
    expect(r3.tiles).toEqual([3, 0, 1]);
  });

  it('matches reference Dijkstra costs on random grids', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const grid = randomGrid(16, 12, 0.3, seed);
      const blocked = grid.blocked as Uint8Array;
      blocked[0] = 0;
      const gx = 15;
      const gy = 11;
      blocked[gy * 16 + gx] = 0;
      const r = findPath(grid, { tx: 0, ty: 0 }, { kind: 'point', x: gx + 0.5, y: gy + 0.5 });
      const ref = referenceCost(grid, 0, 0, gx, gy);
      if (ref === null) {
        expect(r.reached).toBe(false);
      } else {
        expect(r.reached).toBe(true);
        expect(pathCost(grid, r.tiles)).toBe(ref);
      }
    }
  });

  it('falls back to the reachable tile nearest an unreachable goal', () => {
    const grid = gridFromAscii([
      '........',
      '.....###',
      '.....#..',
      '.....#..',
      '.....###',
    ]);
    const r = findPath(grid, { tx: 0, ty: 0 }, { kind: 'point', x: 6.5, y: 2.5 });
    expect(r.reached).toBe(false);
    const end = r.tiles[r.tiles.length - 1]!;
    // Nearest reachable by octile distance to (6,2) is (4,2): distance 2 tiles.
    expect(xy(grid, end)).toEqual([4, 2]);
    pathCost(grid, r.tiles);
    // A blocked goal tile behaves the same way.
    const g2 = gridFromAscii(['....', '..#.', '....']);
    const r2 = findPath(g2, { tx: 0, ty: 1 }, { kind: 'point', x: 2.5, y: 1.5 });
    expect(r2.reached).toBe(false);
    expect(xy(g2, r2.tiles[r2.tiles.length - 1]!)).toEqual([1, 1]);
  });

  it('reaches a footprint goal at any adjacent tile and starts from a walkable tile when blocked', () => {
    const grid = gridFromAscii(['........', '..##....', '..##....', '........']);
    const r = findPath(grid, { tx: 7, ty: 3 }, { kind: 'footprint', tile: { tx: 2, ty: 1 }, size: 2 });
    expect(r.reached).toBe(true);
    const [ex, ey] = xy(grid, r.tiles[r.tiles.length - 1]!);
    expect(ex).toBe(4);
    expect(ey).toBeGreaterThanOrEqual(2);
    // Start inside the footprint: search starts from the nearest walkable tile.
    const r2 = findPath(grid, { tx: 2, ty: 1 }, { kind: 'point', x: 0.5, y: 3.5 });
    expect(r2.reached).toBe(true);
    expect(isWalkable(grid, ...xy(grid, r2.tiles[0]!))).toBe(true);
    expect(nearestWalkableTile(grid, 2, 1)).toEqual({ tx: 2, ty: 0 });
  });

  it('stops at the expansion cap and reports it', () => {
    const grid = openGrid(50, 50);
    const r = findPath(grid, { tx: 0, ty: 0 }, { kind: 'point', x: 49.5, y: 49.5 }, 10);
    expect(r.capped).toBe(true);
    expect(r.expanded).toBe(10);
    expect(r.reached).toBe(false);
  });
});

describe('smoothing', () => {
  it('lineWalkable uses integer steps and refuses corner cuts', () => {
    const grid = gridFromAscii(['....', '.#..', '....']);
    expect(lineWalkable(grid, 0, 0, 3, 0)).toBe(true);
    expect(lineWalkable(grid, 0, 1, 3, 1)).toBe(false);
    // A 45-degree line passing exactly through the pillar's corners is refused.
    expect(lineWalkable(grid, 0, 2, 2, 0)).toBe(false);
    expect(lineWalkable(grid, 2, 0, 3, 1)).toBe(true);
    expect(lineWalkable(grid, 0, 0, 0, 0)).toBe(true);
    // One side of the corner blocked is enough to refuse the diagonal.
    const g2 = gridFromAscii(['.#', '..']);
    expect(lineWalkable(g2, 0, 0, 1, 1)).toBe(false);
    expect(lineWalkable(g2, 0, 1, 1, 1)).toBe(true);
  });

  it('every smoothed segment is walkable (random grids)', () => {
    let segments = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const grid = randomGrid(30, 30, 0.25, seed * 7);
      const blocked = grid.blocked as Uint8Array;
      blocked[0] = 0;
      blocked[30 * 30 - 1] = 0;
      const r = findPath(grid, { tx: 0, ty: 0 }, { kind: 'point', x: 29.5, y: 29.5 });
      const s = smoothPath(grid, r.tiles);
      expect(s[0]).toBe(r.tiles[0]);
      expect(s[s.length - 1]).toBe(r.tiles[r.tiles.length - 1]);
      expect(s.length).toBeLessThanOrEqual(r.tiles.length);
      for (let k = 1; k < s.length; k++) {
        const [ax, ay] = xy(grid, s[k - 1]!);
        const [bx, by] = xy(grid, s[k]!);
        expect(lineWalkable(grid, ax, ay, bx, by)).toBe(true);
        expect(sampledSegmentClear(grid, ax, ay, bx, by)).toBe(true);
        segments++;
      }
    }
    expect(segments).toBeGreaterThan(60);
  });

  it('computePath drops the start tile and ends at the exact goal point', () => {
    const grid = openGrid(10, 10);
    const p = computePath(grid, { tx: 1, ty: 1 }, { kind: 'point', x: 8.25, y: 1.75 });
    expect(p.waypoints).toEqual([{ x: 8.25, y: 1.75 }]);
    const here = computePath(grid, { tx: 1, ty: 1 }, { kind: 'footprint', tile: { tx: 2, ty: 2 }, size: 1 });
    expect(here.reached).toBe(true);
    expect(here.waypoints).toEqual([]);
  });

  it('component labels follow the no-corner-cutting rule', () => {
    const grid = gridFromAscii(['.#', '#.']);
    const labels = componentLabels(grid);
    expect(labels[0]).not.toBe(labels[3]);
    expect(labels[1]).toBe(-1);
  });
});
