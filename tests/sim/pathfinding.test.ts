/**
 * WP2 acceptance at sim scale: 200 units crossing a 120x120 map within the
 * per-tick path budget, and determinism (incl. save/load) with move commands.
 */

import { describe, expect, it } from 'vitest';
import { hashState } from '../../src/sim/hash';
import { createInitialState, simFromState } from '../../src/sim/sim';
import { registry } from '../../src/data/index';
import {
  MAP_SIZE,
  PATH_BUDGET_PER_TICK,
  type Command,
  type GameState,
  type SimContext,
  type UnitEntity,
} from '../../src/sim/types';
import { addUnit, lcg, makeCtx, makeState, step } from '../unit/sim/path/helpers';

const N = MAP_SIZE;

/** 120x120 map: random blobs (~15%), two long walls with gaps, clear start and goal zones. */
function obstacleMap(seed: number): Uint8Array {
  const occ = new Uint8Array(N * N);
  const rnd = lcg(seed);
  for (let b = 0; b < 260; b++) {
    const cx = Math.floor(rnd() * N);
    const cy = Math.floor(rnd() * N);
    const r = 1 + Math.floor(rnd() * 3);
    for (let y = cy - r; y <= cy + r; y++)
      for (let x = cx - r; x <= cx + r; x++) {
        if (x < 0 || y < 0 || x >= N || y >= N) continue;
        if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r) occ[y * N + x] = 1;
      }
  }
  for (let y = 4; y < N - 4; y++) {
    if (y % 30 < 3) continue; // gaps
    occ[y * N + 40] = 1;
    occ[y * N + 80] = 1;
  }
  for (let y = 35; y < 85; y++)
    for (let x = 0; x < 26; x++) {
      occ[y * N + x] = 0;
      occ[y * N + (N - 1 - x)] = 0;
    }
  return occ;
}

interface Scenario {
  ctx: SimContext;
  units: UnitEntity[];
  targets: { x: number; y: number }[];
  commands: Command[];
}

/** 200 units in the west zone, each ordered to its mirrored tile in the east zone. */
function crossingScenario(seed: number): Scenario {
  const state = makeState(N, N);
  const ctx = makeCtx(state, obstacleMap(seed));
  const units: UnitEntity[] = [];
  const targets: { x: number; y: number }[] = [];
  const commands: Command[] = [];
  for (let i = 0; i < 200; i++) {
    const tx = 3 + (i % 20);
    const ty = 40 + Math.floor(i / 20) * 4;
    const u = addUnit(state, 1, tx + 0.5, ty + 0.5);
    units.push(u);
    const target = { x: N - 1 - tx + 0.5, y: ty + 0.5 };
    targets.push(target);
    commands.push({ type: 'move', playerId: 1, seq: i + 1, unitIds: [u.id], x: target.x, y: target.y, queue: false });
  }
  return { ctx, units, targets, commands };
}

function allIdle(state: GameState): boolean {
  return state.entities.every(
    (e) => e.kind !== 'unit' || (e.currentOrder === null && e.orderQueue.length === 0 && e.path === null),
  );
}

describe('pathfinding at scale', () => {
  it('200 units cross a 120x120 map with obstacles within the per-tick budget and all arrive', () => {
    const { ctx, units, targets, commands } = crossingScenario(7);
    let maxExpanded = 0;
    let totalExpanded = 0;
    let ticks = 0;
    let maxQueue = 0;
    const started = performance.now();
    let stats = step(ctx, commands);
    for (;;) {
      ticks++;
      maxExpanded = Math.max(maxExpanded, stats.expanded);
      totalExpanded += stats.expanded;
      maxQueue = Math.max(maxQueue, ctx.state.pathQueue.length);
      for (const u of units) {
        const t = Math.floor(u.pos.y) * N + Math.floor(u.pos.x);
        expect(ctx.runtime.occupancy[t]).toBe(0);
      }
      if (allIdle(ctx.state) || ticks > 3000) break;
      stats = step(ctx);
    }
    const ms = performance.now() - started;
    expect(maxExpanded).toBeLessThanOrEqual(PATH_BUDGET_PER_TICK);
    expect(totalExpanded).toBeGreaterThan(PATH_BUDGET_PER_TICK); // the queue really had to spread work
    expect(ticks).toBeLessThan(3000);
    units.forEach((u, i) => expect(u.pos).toEqual(targets[i]));
    // Informational: whole run including movement and separation.
    console.log(
      `crossing: ${ticks} ticks, ${totalExpanded} expansions, max ${maxExpanded}/tick, max queue ${maxQueue}, ${ms.toFixed(0)} ms`,
    );
  });

  it('a 200-unit group move gives every unit its own tile', () => {
    const { ctx, units } = crossingScenario(11);
    step(ctx, [{ type: 'move', playerId: 1, seq: 1, unitIds: units.map((u) => u.id), x: 100.5, y: 60.5, queue: false }]);
    let ticks = 0;
    while (!allIdle(ctx.state) && ticks < 3000) {
      const s = step(ctx);
      expect(s.expanded).toBeLessThanOrEqual(PATH_BUDGET_PER_TICK);
      ticks++;
    }
    expect(ticks).toBeLessThan(3000);
    const tiles = new Set(units.map((u) => Math.floor(u.pos.y) * N + Math.floor(u.pos.x)));
    expect(tiles.size).toBe(200);
  });
});

describe('determinism with move commands', () => {
  function run(saveLoadAt: number | null): string[] {
    const { ctx, units, commands } = crossingScenario(3);
    let c = ctx;
    const hashes: string[] = [];
    const later: Command[] = [
      { type: 'move', playerId: 1, seq: 1000, unitIds: units.slice(0, 50).map((u) => u.id), x: 60.5, y: 20.5, queue: false },
      { type: 'move', playerId: 1, seq: 1001, unitIds: units.slice(25, 75).map((u) => u.id), x: 30.5, y: 100.5, queue: true },
    ];
    for (let t = 0; t < 400; t++) {
      if (t === saveLoadAt) {
        // Save/load: state through JSON, runtime rebuilt (occupancy copied as WP1 would rebuild it).
        const state = JSON.parse(JSON.stringify(c.state)) as GameState;
        c = makeCtx(state, new Uint8Array(c.runtime.occupancy));
      }
      const cmds = t === 0 ? commands : t === 37 ? later : [];
      step(c, cmds);
      if (t % 20 === 0) hashes.push(hashState(c.state));
    }
    hashes.push(hashState(c.state));
    return hashes;
  }

  it('two runs produce identical hashes, also across save/load', () => {
    const a = run(null);
    const b = run(null);
    expect(b).toEqual(a);
    expect(new Set(a).size).toBeGreaterThan(10); // state actually evolves
    // Load in the middle of busy pathfinding (queue non-empty right after the first commands).
    expect(run(1)).toEqual(a);
    expect(run(38)).toEqual(a);
  });

  it('is deterministic through the public step pipeline', { timeout: 180_000 }, () => {
    function pipeline(): string[] {
      const state = createInitialState({ seed: 5, mapSize: 40, players: [{ civ: 'byzantines' }] }, registry);
      const ids: number[] = [];
      for (let i = 0; i < 10; i++) {
        const u = addUnit(state, 1, 5.5 + i, 5.5);
        u.typeId = 'villager';
        ids.push(u.id);
      }
      const sim = simFromState(state, registry);
      const hashes: string[] = [];
      for (let t = 0; t < 120; t++) {
        const cmds: Command[] =
          t === 0 ? [{ type: 'move', playerId: 1, seq: 1, unitIds: ids, x: 30.5, y: 25.5, queue: false }] : [];
        sim.step(cmds);
        hashes.push(hashState(sim.state));
      }
      const moved = sim.state.entities.filter((e) => e.kind === 'unit' && (e.pos.x !== e.prevPos.x || e.pos.y > 6));
      expect(moved.length).toBeGreaterThan(0);
      return hashes;
    }
    expect(pipeline()).toEqual(pipeline());
  });
});
