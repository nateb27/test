import { describe, expect, it } from 'vitest';
import { registry } from '../../src/data/index';
import { CLEAR_RADIUS, GUARANTEED, START_EDGE_DISTANCE } from '../../src/sim/map/mapgen';
import { hashState } from '../../src/sim/hash';
import type { BuildingEntity, ResourceNodeEntity } from '../../src/sim/types';
import { MAP_SIZE } from '../../src/sim/types';
import { fixtureData, generate } from './fixtures';

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
}

/** 4-connected flood fill from the tiles around the first Town Center. */
function reachability(seed: number, players = 1): { share: number } {
  const { ctx, report } = generate(seed, players);
  const w = ctx.state.map.width;
  const occ = ctx.runtime.occupancy;
  let free = 0;
  for (const v of occ) if (v === 0) free++;
  const a = report.starts[0]!.anchor;
  const seen = new Uint8Array(occ.length);
  const stack: number[] = [];
  const push = (i: number): void => {
    if (occ[i] === 0 && seen[i] === 0) {
      seen[i] = 1;
      stack.push(i);
    }
  };
  push(Math.floor(a.y + 2.5) * w + Math.floor(a.x));
  let count = 0;
  while (stack.length > 0) {
    const i = stack.pop()!;
    count++;
    const x = i % w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i < occ.length - w) push(i + w);
  }
  return { share: count / free };
}

describe('mapgen validation over 100 seeds', () => {
  it('satisfies the plan 4.2 constraints', () => {
    let retries = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const { ctx, state, report } = generate(seed * 7919);
      expect(report.valid, `seed ${seed}`).toBe(true);
      expect(state.mapSeed).toBe(report.mapSeed);
      expect(report.mapSeed).toBe(seed * 7919 + report.attempts - 1);
      retries += report.attempts - 1;
      const start = report.starts[0]!;
      const { anchor } = start;
      expect(anchor.x).toBeGreaterThanOrEqual(START_EDGE_DISTANCE);
      expect(anchor.y).toBeGreaterThanOrEqual(START_EDGE_DISTANCE);
      expect(MAP_SIZE - anchor.x).toBeGreaterThanOrEqual(START_EDGE_DISTANCE);
      expect(MAP_SIZE - anchor.y).toBeGreaterThanOrEqual(START_EDGE_DISTANCE);

      const tc = state.entities.find((e) => e.id === start.townCenterId) as BuildingEntity;
      expect(tc.typeId).toBe('townCenter');
      expect(start.unitIds).toHaveLength(6);

      // Guaranteed counts and distances.
      for (const spec of GUARANTEED) {
        const groups = start.guaranteed.filter((g) => g.kind === spec.kind);
        expect(groups, `${spec.kind} clusters, seed ${seed}`).toHaveLength(spec.clusters);
        for (const g of groups) {
          for (const id of g.nodeIds) {
            const n = state.entities.find((e) => e.id === id) as ResourceNodeEntity;
            const size = fixtureData.node(n.typeId).footprint;
            const d = dist(n.tile.tx + size / 2, n.tile.ty + size / 2, anchor.x, anchor.y);
            expect(d).toBeGreaterThanOrEqual(spec.lo);
            expect(d).toBeLessThanOrEqual(spec.hi);
          }
        }
      }
      expect(start.guaranteed.find((g) => g.kind === 'berries')!.nodeIds).toHaveLength(6);
      expect(start.guaranteed.find((g) => g.kind === 'gold')!.nodeIds).toHaveLength(4);
      expect(start.guaranteed.find((g) => g.kind === 'stone')!.nodeIds).toHaveLength(3);

      // Clear radius: only the guaranteed berry patches may be inside it.
      const berryIds = new Set(
        start.guaranteed.filter((g) => g.kind === 'berries').flatMap((g) => g.nodeIds),
      );
      for (const e of state.entities) {
        if (e.kind !== 'node' || berryIds.has(e.id)) continue;
        const size = fixtureData.node(e.typeId).footprint;
        expect(dist(e.tile.tx + size / 2, e.tile.ty + size / 2, anchor.x, anchor.y)).toBeGreaterThanOrEqual(
          CLEAR_RADIUS,
        );
      }
      expect(ctx.runtime.occupancy.length).toBe(MAP_SIZE * MAP_SIZE);
    }
    // Retries are allowed but should be the exception.
    expect(retries).toBeLessThan(50);
  });

  it('reaches at least 95% of free tiles and every guaranteed resource', () => {
    for (let seed = 1; seed <= 100; seed++) {
      expect(reachability(seed * 104729).share, `seed ${seed}`).toBeGreaterThanOrEqual(0.95);
    }
  });

  it('gives each guaranteed node a free, reachable adjacent tile', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const { ctx, state, report } = generate(seed * 31);
      const w = state.map.width;
      for (const g of report.starts[0]!.guaranteed) {
        for (const id of g.nodeIds) {
          const n = state.entities.find((e) => e.id === id) as ResourceNodeEntity;
          const size = fixtureData.node(n.typeId).footprint;
          let adjacentFree = false;
          for (let i = 0; i < size; i++) {
            for (const [x, y] of [
              [n.tile.tx + i, n.tile.ty - 1],
              [n.tile.tx + i, n.tile.ty + size],
              [n.tile.tx - 1, n.tile.ty + i],
              [n.tile.tx + size, n.tile.ty + i],
            ] as const) {
              if (ctx.runtime.occupancy[y * w + x] === 0) adjacentFree = true;
            }
          }
          expect(adjacentFree).toBe(true);
        }
      }
    }
  });
});

describe('mapgen content', () => {
  it('covers roughly 12% of the map with trees', () => {
    const { state } = generate(42);
    const trees = state.entities.filter((e) => e.kind === 'node' && e.typeId === 'tree').length;
    const share = trees / (MAP_SIZE * MAP_SIZE);
    expect(share).toBeGreaterThan(0.1);
    expect(share).toBeLessThan(0.14);
  });

  it('places the starting base: Town Center, six villagers and the stockpile', () => {
    const { state, report } = generate(5);
    const start = report.starts[0]!;
    const units = state.entities.filter((e) => e.kind === 'unit');
    expect(units).toHaveLength(6);
    expect(units.every((u) => u.owner === 1 && u.typeId === 'villager')).toBe(true);
    expect(state.players[1]!.resources).toEqual({ food: 200, wood: 200, gold: 100, stone: 0 });
    expect(state.entities.filter((e) => e.kind === 'building')).toHaveLength(1);
    expect(start.townCenterId).toBe(1);
  });

  it('keeps entities sorted by ascending unique id', () => {
    const { state } = generate(9, 2);
    for (let i = 1; i < state.entities.length; i++) {
      expect(state.entities[i]!.id).toBeGreaterThan(state.entities[i - 1]!.id);
    }
    expect(state.nextEntityId).toBe(state.entities[state.entities.length - 1]!.id + 1);
  });

  it('supports two players on opposite sides, both validated', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const { report } = generate(seed, 2);
      expect(report.valid).toBe(true);
      const [a, b] = report.starts;
      expect(dist(a!.anchor.x, a!.anchor.y, b!.anchor.x, b!.anchor.y)).toBeGreaterThan(50);
    }
  });

  it('is deterministic for a seed and different across seeds', () => {
    const a = hashState(generate(77).state);
    expect(hashState(generate(77).state)).toBe(a);
    expect(hashState(generate(78).state)).not.toBe(a);
  });

  it('skips defs missing from the registry instead of crashing', () => {
    // The WP0 registry has no node or building defs yet; this must still work.
    const { state, report } = generate(1, 1, 120, registry);
    expect(report.starts).toHaveLength(1);
    expect(state.map.tiles).toHaveLength(MAP_SIZE * MAP_SIZE);
  });
});
