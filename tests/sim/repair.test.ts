/** WP24: repair (PLAN-M2 4.12), construction HP (4.11), combat separation (4.7) and `directPath` (4.6). */

import { describe, expect, it } from 'vitest';
import { registry } from '../../src/data/index';
import { createGame, deserialize, hashState, serialize } from '../../src/sim';
import { createBuilding, createNode, createUnit, findEntity } from '../../src/sim/entities';
import { directPath } from '../../src/sim/path/follow';
import { rebuildRuntime } from '../../src/sim/runtime';
import { createInitialState, simFromState } from '../../src/sim/sim';
import { buildingCombat } from '../../src/sim/systems/combat/damage';
import { runMovement } from '../../src/sim/systems/movement';
import { COMBAT_SEPARATION_RADIUS, SEPARATION_RADIUS, TICK_RATE } from '../../src/sim/types';
import type { BuildingEntity, Command, RepairCommand, CommandInput, GameState, Sim, SimContext, SimEvent, UnitEntity } from '../../src/sim/types';

const P1 = 1;
const BARRACKS = registry.building('barracks');
const MAX = 1200;

interface World {
  state: GameState;
  sim: Sim;
  seq: number;
  events: SimEvent[];
  barracksId: number;
  villagers: number[];
}

/** One player, a completed Barracks at (10,10) at `hp`, `n` villagers standing next to it. */
function world(n: number, hp: number, wood = 1000): World {
  const state = createInitialState({ seed: 7, mapSize: 40, players: [{ civ: 'byzantines' }, { civ: 'byzantines' }] }, registry);
  state.players[P1]!.resources = { food: 0, wood, gold: 0, stone: 0 };
  const b = createBuilding(state, 'barracks', P1, 10, 10, true);
  b.hp = hp;
  const spots = [
    [9.5, 10.5],
    [9.5, 11.5],
    [9.5, 12.5],
    [10.5, 9.5],
  ];
  const villagers = spots.slice(0, n).map(([x, y]) => createUnit(state, 'villager', P1, x!, y!).id);
  return { state, sim: simFromState(state), seq: 1, events: [], barracksId: b.id, villagers };
}

function step(w: World, ...inputs: CommandInput[]): SimEvent[] {
  const events = w.sim.step(inputs.map((i) => ({ ...i, playerId: P1, seq: w.seq++ }) as Command));
  w.events.push(...events);
  return events;
}
function run(w: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) step(w);
}
const bld = (w: World): BuildingEntity => findEntity(w.state, w.barracksId) as BuildingEntity;
const repairCmd = (w: World, ids = w.villagers): Omit<RepairCommand, 'playerId' | 'seq'> => ({ type: 'repair', unitIds: ids, buildingId: w.barracksId, queue: false });
const rejection = (events: SimEvent[]): string | null => {
  for (const e of events) if (e.type === 'CommandRejected') return e.reason;
  return null;
};

describe('repair rate and cost (4.12)', () => {
  it('uses the building rate formula with 1 to 4 repairers', () => {
    const base = Math.max(registry.combat.repairMinHpPerSecond, (registry.combat.repairRateFactor * MAX) / BARRACKS.buildTime);
    for (let n = 1; n <= 4; n++) {
      const w = world(n, 100);
      step(w, repairCmd(w));
      expect(bld(w).repairerIds, `n=${n}`).toHaveLength(n);
      const hp0 = bld(w).hp;
      run(w, 200);
      const gained = bld(w).hp - hp0;
      const expected = (base * (1 + 0.5 * (n - 1)) * 200) / TICK_RATE;
      expect(Math.abs(gained - expected), `n=${n}: ${gained} vs ${expected}`).toBeLessThanOrEqual(1.5);
    }
  });

  it('a full repair costs 50% of the building cost (+-1 per resource) and ends with VillagerIdle', () => {
    const w = world(4, 1);
    step(w, repairCmd(w));
    for (let i = 0; i < 4000 && bld(w).hp < MAX; i++) step(w);
    const b = bld(w);
    expect(b.hp).toBe(MAX);
    const spent = 1000 - w.state.players[P1]!.resources.wood;
    const expected = (BARRACKS.cost.wood ?? 0) / 2;
    expect(Math.abs(spent - expected * ((MAX - 1) / MAX))).toBeLessThanOrEqual(1);
    expect(w.state.players[P1]!.resources.food).toBe(0);
    expect(b.repairAccumulator).toBe(0);
    expect(b.repairCostAccumulator).toEqual({ food: 0, wood: 0, gold: 0, stone: 0 });
    run(w, 3);
    expect(b.repairerIds).toEqual([]);
    const idle = w.events.filter((e) => e.type === 'VillagerIdle');
    expect(idle.map((e) => (e as { unitId: number }).unitId).sort()).toEqual([...w.villagers].sort());
    for (const id of w.villagers) expect((findEntity(w.state, id) as UnitEntity).currentOrder).toBeNull();
  });

  it('stalls when unaffordable and resumes when affordable', () => {
    const w = world(2, 200, 0);
    step(w, repairCmd(w));
    run(w, 300);
    const stalled = bld(w).hp;
    expect(stalled).toBeLessThan(200 + 40); // only the free fraction (under one wood) was bought
    run(w, 100);
    expect(bld(w).hp).toBe(stalled);
    expect(bld(w).repairAccumulator).toBeLessThan(1);
    expect(w.state.players[P1]!.resources.wood).toBe(0);
    w.state.players[P1]!.resources.wood = 500;
    run(w, 200);
    expect(bld(w).hp).toBeGreaterThan(stalled + 20);
    expect(w.state.players[P1]!.resources.wood).toBeLessThan(500);
  });

  it('repairers who leave are pruned and stop contributing', () => {
    const w = world(2, 100);
    step(w, repairCmd(w));
    expect(bld(w).repairerIds).toHaveLength(2);
    step(w, { type: 'stop', unitIds: [w.villagers[0]!] });
    run(w, 2);
    expect(bld(w).repairerIds).toEqual([w.villagers[1]]);
  });

  it('a repairer far away walks to the building first', () => {
    const w = world(1, 100);
    const u = findEntity(w.state, w.villagers[0]!) as UnitEntity;
    u.pos = { x: 20.5, y: 20.5 };
    u.prevPos = { x: 20.5, y: 20.5 };
    step(w, repairCmd(w));
    expect(bld(w).repairerIds).toEqual([]);
    let ticks = 0;
    while (bld(w).repairerIds.length === 0 && ticks++ < 600) step(w);
    expect(bld(w).repairerIds).toEqual([u.id]);
    const hp = bld(w).hp;
    run(w, 100);
    expect(bld(w).hp).toBeGreaterThan(hp);
  });

  it('works while the building is being damaged', () => {
    const w = world(1, 600);
    step(w, repairCmd(w));
    for (let i = 0; i < 100; i++) {
      bld(w).hp -= 1;
      step(w);
    }
    expect(bld(w).hp).toBeGreaterThan(500);
    expect(bld(w).hp).toBeLessThan(600);
  });

  it('the order is done when the building is destroyed', () => {
    const w = world(1, 600);
    step(w, repairCmd(w));
    run(w, 5);
    w.state.entities = w.state.entities.filter((e) => e.id !== w.barracksId);
    run(w, 2);
    expect((findEntity(w.state, w.villagers[0]!) as UnitEntity).currentOrder).toBeNull();
  });
});

describe('repair command validation (4.8)', () => {
  it('rejects full hp, unfinished, foreign, non-building and unable units; accepts a damaged own building', () => {
    const w = world(1, MAX);
    expect(rejection(step(w, repairCmd(w)))).toBe('invalidTarget');
    bld(w).hp = 500;
    const spear = createUnit(w.state, 'spearman', P1, 5.5, 5.5);
    expect(rejection(step(w, repairCmd(w, [spear.id])))).toBe('cannotPerform');
    expect(rejection(step(w, { ...repairCmd(w), buildingId: 9999 }))).toBe('unknownEntity');
    expect(rejection(step(w, { ...repairCmd(w), buildingId: w.villagers[0]! }))).toBe('invalidTarget');
    const node = createNode(w.state, 'tree', 3, 3, 100);
    expect(rejection(step(w, { ...repairCmd(w), buildingId: node.id }))).toBe('invalidTarget');
    const foundation = createBuilding(w.state, 'house', P1, 20, 20, false);
    expect(rejection(step(w, { ...repairCmd(w), buildingId: foundation.id }))).toBe('invalidTarget');
    const foreign = createBuilding(w.state, 'barracks', 2, 30, 30, true);
    foreign.hp = 10;
    expect(rejection(step(w, { ...repairCmd(w), buildingId: foreign.id }))).toBe('invalidTarget');
    expect(rejection(step(w, repairCmd(w)))).toBeNull();
    expect((findEntity(w.state, w.villagers[0]!) as UnitEntity).currentOrder?.type).toBe('repair');
  });

  it('queue appends the order', () => {
    const w = world(1, 500);
    step(w, { type: 'move', unitIds: [w.villagers[0]!], x: 9.5, y: 14.5, queue: false });
    step(w, { ...repairCmd(w), queue: true });
    const u = findEntity(w.state, w.villagers[0]!) as UnitEntity;
    expect([u.currentOrder?.type, ...u.orderQueue.map((o) => o.type)]).toContain('repair');
  });
});

describe('construction hp (4.11)', () => {
  const ctxOf = (w: World): SimContext => ({ state: w.state, runtime: rebuildRuntime(w.state, registry), data: registry, events: [] });

  it('starts at 10% (min 1), grows with progress and reaches max on completion', () => {
    const w = world(2, MAX);
    const f = createBuilding(w.state, 'house', P1, 20, 20, false);
    const max = buildingCombat(ctxOf(w), P1, 'house').maxHp;
    expect(f.hp).toBe(Math.max(1, Math.floor(max / 10)));
    const sim = simFromState(w.state);
    let seq = 1;
    const stepSim = (inputs: CommandInput[] = []): void => {
      sim.step(inputs.map((i) => ({ ...i, playerId: P1, seq: seq++ }) as Command));
    };
    stepSim([{ type: 'assist', unitIds: w.villagers, buildingId: f.id, queue: false }]);
    const b = findEntity(w.state, f.id) as BuildingEntity;
    let last = b.hp;
    let sawMiddle = false;
    for (let i = 0; i < 4000 && !b.constructed; i++) {
      stepSim();
      expect(b.hp).toBeGreaterThanOrEqual(last);
      expect(b.hp).toBeLessThanOrEqual(max);
      if (b.progress > 0.45 && b.progress < 0.55) {
        sawMiddle = true;
        expect(Math.abs(b.hp - max * (0.1 + 0.9 * b.progress))).toBeLessThanOrEqual(2);
      }
      last = b.hp;
    }
    expect(sawMiddle).toBe(true);
    expect(b.constructed).toBe(true);
    expect(b.hp).toBe(max);
    expect(b.builtHp).toBe(max);
  });

  it('damage taken during construction persists and finishing does not heal it', () => {
    const w = world(2, MAX);
    const f = createBuilding(w.state, 'house', P1, 20, 20, false);
    const max = buildingCombat(ctxOf(w), P1, 'house').maxHp;
    const sim = simFromState(w.state);
    let seq = 1;
    const stepSim = (inputs: CommandInput[] = []): void => {
      sim.step(inputs.map((i) => ({ ...i, playerId: P1, seq: seq++ }) as Command));
    };
    stepSim([{ type: 'assist', unitIds: w.villagers, buildingId: f.id, queue: false }]);
    const b = findEntity(w.state, f.id) as BuildingEntity;
    for (let i = 0; i < 4000 && b.progress < 0.5; i++) stepSim();
    b.hp -= 100;
    for (let i = 0; i < 4000 && !b.constructed; i++) stepSim();
    expect(b.constructed).toBe(true);
    expect(b.hp).toBe(max - 100);
  });

  it('a unit-sized foundation never starts below 1 hp', () => {
    const w = world(1, MAX);
    const f = createBuilding(w.state, 'house', P1, 20, 20, false, undefined, registry, 5);
    expect(f.hp).toBe(1);
  });
});

describe('determinism', () => {
  it('repair runs hash identically, also across a save and load', () => {
    const a = world(3, 300);
    const b = world(3, 300);
    step(a, repairCmd(a));
    step(b, repairCmd(b));
    run(a, 150);
    run(b, 75);
    const loaded = deserialize(serialize(b.sim));
    b.sim = loaded;
    b.state = loaded.state as GameState;
    run(b, 75);
    expect(hashState(a.sim.state)).toBe(hashState(b.sim.state));
    expect(bld(a).hp).toBeGreaterThan(300);
  });

  it('createGame two-player sims with repair hash identically', () => {
    const make = (): Sim => createGame({ seed: 5, mapSize: 64, players: [{ civ: 'byzantines' }, { civ: 'byzantines' }] });
    const s1 = make();
    const s2 = make();
    const tc = s1.state.entities.find((e) => e.kind === 'building' && e.owner === 1) as BuildingEntity;
    const vill = s1.state.entities.find((e) => e.kind === 'unit' && e.owner === 1) as UnitEntity;
    for (const s of [s1, s2]) {
      (s.state.entities.find((e) => e.id === tc.id) as BuildingEntity).hp = 1000;
      s.step([{ type: 'repair', unitIds: [vill.id], buildingId: tc.id, queue: false, playerId: 1, seq: 1 }]);
      for (let i = 0; i < 300; i++) s.step([]);
    }
    expect(hashState(s1.state)).toBe(hashState(s2.state));
    expect((s1.state.entities.find((e) => e.id === tc.id) as BuildingEntity).hp).toBeGreaterThan(1000);
  });
});

describe('combat separation (4.7)', () => {
  function sepCtx(): SimContext {
    const state = createInitialState({ seed: 1, mapSize: 40, players: [{ civ: 'byzantines' }] }, registry);
    return { state, runtime: rebuildRuntime(state, registry), data: registry, events: [] };
  }
  const attacking = (u: UnitEntity, target: number): void => {
    u.currentOrder = { type: 'attack', targetId: target, auto: false, phase: 'attacking', anchor: null, repathTick: 0 };
  };
  const d = (a: UnitEntity, b: UnitEntity): number => Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y);

  it('stationary attackers end at least 0.45 apart', () => {
    const ctx = sepCtx();
    const us = [0, 1, 2, 3, 4].map((i) => createUnit(ctx.state, 'spearman', P1, 10.5 + i * 0.05, 10.5 + (i % 2) * 0.05));
    for (const u of us) attacking(u, 999);
    for (let i = 0; i < 80; i++) runMovement(ctx);
    for (let i = 0; i < us.length; i++) {
      for (let j = i + 1; j < us.length; j++) expect(d(us[i]!, us[j]!)).toBeGreaterThanOrEqual(COMBAT_SEPARATION_RADIUS - 0.005);
    }
  });

  it('attackers also push apart from idle units, which keep their own 0.3 spacing among themselves', () => {
    const ctx = sepCtx();
    const att = createUnit(ctx.state, 'spearman', P1, 10.5, 10.5);
    attacking(att, 999);
    const idle = createUnit(ctx.state, 'villager', P1, 10.6, 10.5);
    const idle2 = createUnit(ctx.state, 'villager', P1, 20.5, 20.5);
    const idle3 = createUnit(ctx.state, 'villager', P1, 20.4, 20.5);
    for (let i = 0; i < 80; i++) runMovement(ctx);
    expect(d(att, idle)).toBeGreaterThanOrEqual(COMBAT_SEPARATION_RADIUS - 0.005);
    expect(d(idle2, idle3)).toBeGreaterThanOrEqual(SEPARATION_RADIUS - 0.005);
    expect(d(idle2, idle3)).toBeLessThan(COMBAT_SEPARATION_RADIUS);
  });

  it('moving units and attackers with a path are not pushed', () => {
    const ctx = sepCtx();
    const a = createUnit(ctx.state, 'spearman', P1, 10.5, 10.5);
    const b = createUnit(ctx.state, 'spearman', P1, 10.5, 10.5);
    attacking(a, 999);
    attacking(b, 999);
    b.path = { waypoints: [{ x: 10.5, y: 10.5 }], nextIndex: 1, occupancyVersion: 0 };
    runMovement(ctx);
    expect(a.pos).toEqual({ x: 10.5, y: 10.5 });
  });

  it('never pushes a unit onto a blocked tile', () => {
    const state = createInitialState({ seed: 1, mapSize: 40, players: [{ civ: 'byzantines' }] }, registry);
    createBuilding(state, 'barracks', P1, 11, 10, true);
    const ctx: SimContext = { state, runtime: rebuildRuntime(state, registry), data: registry, events: [] };
    const us = [0, 1, 2].map((i) => createUnit(state, 'spearman', P1, 10.9 + i * 0.02, 10.5 + i * 0.1));
    for (const u of us) attacking(u, 999);
    for (let i = 0; i < 60; i++) runMovement(ctx);
    for (const u of us) {
      expect(u.pos.x).toBeLessThan(11);
      expect(ctx.runtime.occupancy[Math.floor(u.pos.y) * 40 + Math.floor(u.pos.x)]).toBe(0);
    }
  });

  it('is deterministic', () => {
    const hashes = [0, 1].map(() => {
      const ctx = sepCtx();
      for (let i = 0; i < 6; i++) attacking(createUnit(ctx.state, 'spearman', P1, 12.5 + i * 0.03, 12.5), 999);
      for (let i = 0; i < 30; i++) runMovement(ctx);
      return hashState(ctx.state);
    });
    expect(hashes[0]).toBe(hashes[1]);
  });
});

describe('directPath (4.6)', () => {
  it('sets a one-waypoint path when the straight segment is walkable', () => {
    const state = createInitialState({ seed: 1, mapSize: 40, players: [{ civ: 'byzantines' }] }, registry);
    const ctx: SimContext = { state, runtime: rebuildRuntime(state, registry), data: registry, events: [] };
    const u = createUnit(state, 'spearman', P1, 5.5, 5.5);
    expect(directPath(ctx, u, 8.5, 6.5)).toBe(true);
    expect(u.path).toEqual({ waypoints: [{ x: 8.5, y: 6.5 }], nextIndex: 0, occupancyVersion: state.occupancyVersion });
    runMovementUntil(ctx, u);
    expect(u.pos.x).toBeCloseTo(8.5, 5);
    expect(u.pos.y).toBeCloseTo(6.5, 5);
  });

  it('returns false and changes nothing when the segment is blocked', () => {
    const state = createInitialState({ seed: 1, mapSize: 40, players: [{ civ: 'byzantines' }] }, registry);
    createBuilding(state, 'barracks', P1, 7, 4, true);
    const ctx: SimContext = { state, runtime: rebuildRuntime(state, registry), data: registry, events: [] };
    const u = createUnit(state, 'spearman', P1, 5.5, 5.5);
    expect(directPath(ctx, u, 12.5, 5.5)).toBe(false);
    expect(u.path).toBeNull();
    expect(directPath(ctx, u, Number.NaN, 5)).toBe(false);
  });

  function runMovementUntil(ctx: SimContext, u: UnitEntity): void {
    for (let i = 0; i < 200 && u.path !== null; i++) runMovement(ctx);
  }
});
