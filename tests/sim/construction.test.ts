import { describe, expect, it, vi } from 'vitest';
import { createRegistry, registry } from '../../src/data/index';
import type { DataRegistry } from '../../src/data/schema';
import { createGame, deserialize, hashState, serialize } from '../../src/sim';
import { createBuilding, createNode, createUnit, findEntity } from '../../src/sim/entities';
import { rebuildRuntime } from '../../src/sim/runtime';
import { createInitialState, simFromState } from '../../src/sim/sim';
import { applyAssistCommand, buildOrderHandler } from '../../src/sim/systems/orders/build';
import type {
  Availability,
  BuildingEntity,
  Command,
  CommandInput,
  GameState,
  PlayerId,
  ProducibleId,
  RejectReason,
  ResourceAmounts,
  Sim,
  SimContext,
  SimEvent,
  UnitEntity,
  UnavailableReason,
} from '../../src/sim/types';

// `availability` belongs to WP8 (currently a stub). These tests inject a simple stand-in so they
// do not depend on it: every def is available (unless overridden) at its base cost.
const mock = vi.hoisted(() => ({
  unavailable: [] as unknown[],
  costOverride: null as null | Record<string, number>,
}));

vi.mock('../../src/sim/rules/availability', () => ({
  availability: (ctx: SimContext, playerId: PlayerId, defId: ProducibleId): Availability => {
    const def = ctx.data.producible(defId);
    const base = mock.costOverride ?? (def?.cost ?? {});
    const cost: ResourceAmounts = {
      food: base.food ?? 0,
      wood: base.wood ?? 0,
      gold: base.gold ?? 0,
      stone: base.stone ?? 0,
    };
    const res = ctx.state.players[playerId]!.resources;
    const shortfall: ResourceAmounts = {
      food: Math.max(0, cost.food - res.food),
      wood: Math.max(0, cost.wood - res.wood),
      gold: Math.max(0, cost.gold - res.gold),
      stone: Math.max(0, cost.stone - res.stone),
    };
    const reasons = mock.unavailable as UnavailableReason[];
    return {
      available: reasons.length === 0,
      hidden: false,
      reasons: [...reasons],
      cost,
      affordable: shortfall.food + shortfall.wood + shortfall.gold + shortfall.stone === 0,
      shortfall,
    };
  },
}));

const P1 = 1;

interface World {
  state: GameState;
  sim: Sim;
  units: UnitEntity[];
  seq: number;
  events: SimEvent[];
}

interface WorldOptions {
  data?: DataRegistry;
  villagers?: { x: number; y: number }[];
  extra?: (state: GameState) => void;
}

function world(opts: WorldOptions = {}): World {
  const data = opts.data ?? registry;
  const state = createInitialState({ seed: 7, mapSize: 40, players: [{ civ: 'byzantines' }] }, data);
  state.players[P1]!.resources = { food: 1000, wood: 1000, gold: 1000, stone: 1000 };
  const units = (opts.villagers ?? [{ x: 5.5, y: 5.5 }]).map((p) => createUnit(state, 'villager', P1, p.x, p.y));
  opts.extra?.(state);
  return { state, sim: simFromState(state, data), units, seq: 1, events: [] };
}

function cmd(w: World, input: CommandInput): Command {
  return { ...input, playerId: P1, seq: w.seq++ } as Command;
}

function step(w: World, ...inputs: CommandInput[]): SimEvent[] {
  const events = w.sim.step(inputs.map((i) => cmd(w, i)));
  w.events.push(...events);
  return events;
}

function run(w: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) step(w);
}

function rejected(events: SimEvent[]): RejectReason | null {
  for (const e of events) if (e.type === 'CommandRejected') return e.reason;
  return null;
}

function building(w: World, id: number): BuildingEntity {
  const e = findEntity(w.state, id);
  if (e === undefined || e.kind !== 'building') throw new Error('no building');
  return e;
}

function placedId(events: SimEvent[]): number {
  for (const e of events) if (e.type === 'BuildingPlaced') return e.buildingId;
  throw new Error('no BuildingPlaced');
}

function unit(w: World, i = 0): UnitEntity {
  const u = w.units[i];
  if (u === undefined) throw new Error('no unit');
  return findEntity(w.state, u.id) as UnitEntity;
}

function place(w: World, type: string, tx: number, ty: number, queue = false, unitIds?: number[]): SimEvent[] {
  return step(w, { type: 'build', unitIds: unitIds ?? [w.units[0]!.id], buildingType: type, tx, ty, queue });
}

describe('canPlace reason codes', () => {
  const withRock = createRegistry({
    units: registry.units,
    buildings: registry.buildings,
    techs: registry.techs,
    ages: registry.ages,
    civs: registry.civs,
    nodes: registry.nodes,
    terrains: [...registry.terrains, { id: 'rock', name: 'Rock', walkable: true, buildable: false, minimapColor: 0, variants: 1 }],
    start: registry.start,
  });

  it('ok on free ground', () => {
    const w = world();
    const r = w.sim.query.canPlace(P1, 'house', 10, 10);
    expect(r.ok).toBe(true);
    expect(r.size).toBe(2);
    expect(r.tiles).toEqual([null, null, null, null]);
  });

  it('outOfBounds, per tile', () => {
    const w = world();
    const r = w.sim.query.canPlace(P1, 'house', -1, 0);
    expect(r.ok).toBe(false);
    expect(r.tiles).toEqual(['outOfBounds', null, 'outOfBounds', null]);
    expect(w.sim.query.canPlace(P1, 'house', 39, 39).tiles).toEqual([null, 'outOfBounds', 'outOfBounds', 'outOfBounds']);
  });

  it('notBuildable terrain', () => {
    const w = world({
      data: withRock,
      extra: (s) => {
        s.map.tiles[10 * 40 + 10] = 'rock';
      },
    });
    const r = w.sim.query.canPlace(P1, 'house', 10, 10);
    expect(r.ok).toBe(false);
    expect(r.tiles).toEqual(['notBuildable', null, null, null]);
  });

  it('occupied by a building, a node, and a non-blocking farm', () => {
    const w = world({
      extra: (s) => {
        createBuilding(s, 'house', P1, 10, 10, true);
        createNode(s, 'tree', 20, 20, 100);
        createBuilding(s, 'farm', P1, 30, 30, true);
      },
    });
    expect(w.sim.query.canPlace(P1, 'house', 11, 11).tiles).toEqual(['occupied', null, null, null]);
    expect(w.sim.query.canPlace(P1, 'house', 19, 19).tiles).toEqual([null, null, null, 'occupied']);
    const r = w.sim.query.canPlace(P1, 'farm', 31, 31);
    expect(r.ok).toBe(false);
    expect(r.tiles).toEqual(['occupied', null, null, null]);
  });

  it('unavailable and affordability are passed through', () => {
    const w = world();
    w.state.players[P1]!.resources.wood = 10;
    const poor = w.sim.query.canPlace(P1, 'house', 10, 10);
    expect(poor.ok).toBe(false);
    expect(poor.availability.affordable).toBe(false);
    expect(poor.availability.shortfall.wood).toBe(40);
    mock.unavailable = [{ code: 'requiresAge', age: 2 }];
    try {
      const r = w.sim.query.canPlace(P1, 'house', 10, 10);
      expect(r.ok).toBe(false);
      expect(r.availability.reasons).toEqual([{ code: 'requiresAge', age: 2 }]);
    } finally {
      mock.unavailable = [];
    }
  });

  it('build limit counts unfinished foundations', () => {
    const w = world({
      extra: (s) => {
        createBuilding(s, 'silkWorkshop', P1, 10, 10, true);
        createBuilding(s, 'silkWorkshop', P1, 15, 10, false);
        createBuilding(s, 'silkWorkshop', P1, 20, 10, false);
      },
    });
    const r = w.sim.query.canPlace(P1, 'silkWorkshop', 25, 20);
    expect(r.ok).toBe(false);
    expect(r.tiles.every((t) => t === null)).toBe(true);
    expect(r.availability.available).toBe(false);
    expect(r.availability.reasons).toContainEqual({ code: 'buildLimit', limit: 3 });
    expect(w.sim.query.canPlace(P1, 'house', 25, 20).ok).toBe(true);
  });

  it('never ok for the Town Center or an unknown def', () => {
    const w = world();
    expect(w.sim.query.canPlace(P1, 'townCenter', 10, 10).ok).toBe(false);
    expect(w.sim.query.canPlace(P1, 'nope', 10, 10).ok).toBe(false);
  });
});

describe('build command', () => {
  it('places and pays for the foundation immediately', () => {
    const w = world();
    const events = place(w, 'house', 10, 10);
    expect(rejected(events)).toBeNull();
    const b = building(w, placedId(events));
    expect(b.constructed).toBe(false);
    expect(b.progress).toBe(0);
    expect(b.costPaid).toEqual({ food: 0, wood: 50, gold: 0, stone: 0 });
    expect(w.state.players[P1]!.resources.wood).toBe(950);
    expect(events).toContainEqual({ type: 'BuildingPlaced', playerId: P1, buildingId: b.id, buildingType: 'house', tx: 10, ty: 10 });
    expect(w.state.occupancyVersion).toBe(1);
    const occ = (x: number, y: number) => (w.sim.query.canPlace(P1, 'house', x, y).tiles[0] === 'occupied' ? 1 : 0);
    expect(occ(10, 10) + occ(11, 11)).toBe(2);
    expect(unit(w).currentOrder).toMatchObject({ type: 'build', buildingId: b.id });
  });

  it('rejects with the right reasons and changes nothing', () => {
    const w = world({ extra: (s) => createUnit(s, 'spearman', P1, 8.5, 8.5) });
    const wood = w.state.players[P1]!.resources.wood;
    const spear = w.state.entities.find((e) => e.kind === 'unit' && e.typeId === 'spearman')!;
    expect(rejected(step(w, { type: 'build', unitIds: [spear.id], buildingType: 'house', tx: 10, ty: 10, queue: false }))).toBe('cannotPerform');
    expect(rejected(place(w, 'nope', 10, 10))).toBe('unknownDef');
    expect(rejected(place(w, 'townCenter', 10, 10))).toBe('invalidTarget');
    const bad = place(w, 'house', -1, 10);
    expect(bad.find((e) => e.type === 'CommandRejected')).toMatchObject({ reason: 'cannotPlace', placement: ['outOfBounds', 'outOfBounds'] });
    mock.unavailable = [{ code: 'requiresAge', age: 2 }];
    try {
      expect(place(w, 'house', 10, 10).find((e) => e.type === 'CommandRejected')).toMatchObject({
        reason: 'notAvailable',
        unavailable: [{ code: 'requiresAge', age: 2 }],
      });
    } finally {
      mock.unavailable = [];
    }
    w.state.players[P1]!.resources.wood = 20;
    expect(place(w, 'house', 10, 10).find((e) => e.type === 'CommandRejected')).toMatchObject({
      reason: 'cannotAfford',
      shortfall: { food: 0, wood: 30, gold: 0, stone: 0 },
    });
    expect(w.state.players[P1]!.resources.wood).toBe(20);
    expect(w.state.entities.some((e) => e.kind === 'building')).toBe(false);
    expect(wood).toBe(1000);
    expect(w.state.occupancyVersion).toBe(0);
  });

  it('displaces units standing inside the footprint to the nearest free tile', () => {
    const w = world({ villagers: [{ x: 5.5, y: 5.5 }, { x: 10.5, y: 10.5 }, { x: 11.2, y: 10.9 }] });
    place(w, 'house', 10, 10, false, [w.units[0]!.id]);
    for (const i of [1, 2]) {
      const u = unit(w, i);
      const tx = Math.floor(u.pos.x);
      const ty = Math.floor(u.pos.y);
      const inside = tx >= 10 && tx < 12 && ty >= 10 && ty < 12;
      expect(inside).toBe(false);
      expect(Math.abs(u.pos.x - 11)).toBeLessThanOrEqual(2);
      expect(u.pos.x % 1).toBe(0.5);
      expect(u.pos.y % 1).toBe(0.5);
    }
    expect(unit(w, 1).pos).toEqual({ x: 10.5, y: 9.5 }); // tie between two free tiles: lowest tile index
  });

  it('a unit whose path crosses a new foundation re-paths and arrives', () => {
    const w = world({ villagers: [{ x: 5.5, y: 10.5 }, { x: 30.5, y: 30.5 }] });
    step(w, { type: 'move', unitIds: [w.units[0]!.id], x: 20.5, y: 10.5, queue: false });
    run(w, 6);
    expect(unit(w).path).not.toBeNull();
    place(w, 'barracks', 11, 9, false, [w.units[1]!.id]);
    run(w, 400);
    const u = unit(w);
    expect(Math.abs(u.pos.x - 20.5)).toBeLessThan(0.2);
    expect(Math.abs(u.pos.y - 10.5)).toBeLessThan(0.2);
    expect(u.currentOrder).toBeNull();
  });

  it('farms do not block pathing and displace nobody, but cannot overlap another farm', () => {
    const w = world({ villagers: [{ x: 5.5, y: 5.5 }, { x: 10.5, y: 10.5 }] });
    const events = place(w, 'farm', 10, 10);
    expect(rejected(events)).toBeNull();
    expect(w.state.occupancyVersion).toBe(0);
    expect(unit(w, 1).pos).toEqual({ x: 10.5, y: 10.5 });
    expect(rejected(place(w, 'farm', 11, 11))).toBe('cannotPlace');
    expect(w.state.players[P1]!.resources.wood).toBe(950);
  });

  it('enforces the Silk Workshop limit of 3, counting unfinished ones', () => {
    const w = world();
    for (let i = 0; i < 3; i++) expect(rejected(place(w, 'silkWorkshop', 8 + i * 5, 20, true))).toBeNull();
    const events = place(w, 'silkWorkshop', 8, 30, true);
    expect(events.find((e) => e.type === 'CommandRejected')).toMatchObject({ reason: 'notAvailable', unavailable: [{ code: 'buildLimit', limit: 3 }] });
    expect(w.state.entities.filter((e) => e.kind === 'building')).toHaveLength(3);
  });

  it('queued foundations are built in order', () => {
    const w = world();
    const a = placedId(place(w, 'house', 8, 5));
    const b = placedId(place(w, 'house', 14, 5, true));
    const c = placedId(place(w, 'house', 20, 5, true));
    expect(w.state.players[P1]!.resources.wood).toBe(850);
    run(w, 1500);
    const done = w.events.filter((e) => e.type === 'BuildingCompleted').map((e) => (e as { buildingId: number }).buildingId);
    expect(done).toEqual([a, b, c]);
    expect(unit(w).currentOrder).toBeNull();
    expect(w.events.filter((e) => e.type === 'VillagerIdle')).toHaveLength(1);
  });
});

describe('construction progress', () => {
  /** Builders standing next to a house at (10,10); returns the tick (1-based) on which it completed. */
  function completionTick(n: number): { tick: number; progress400: number } {
    const w = world({ villagers: Array.from({ length: n }, (_, i) => ({ x: 9.5, y: 10.5 + i * 0.01 })) });
    const ids = w.units.map((u) => u.id);
    const id = placedId(place(w, 'house', 10, 10, false, ids));
    // Placing in the same tick already counts as tick 1 of building (adjacent builders).
    let progressAt100 = building(w, id).progress;
    let tick = 1;
    for (; tick < 1000; tick++) {
      if (tick === 100) progressAt100 = building(w, id).progress;
      if (building(w, id).constructed) break;
      step(w);
    }
    return { tick, progress400: progressAt100 };
  }

  it('single builder: buildTime x 20 ticks exactly (house: 20 s = 400 ticks)', () => {
    const r = completionTick(1);
    expect(r.tick).toBe(400);
    expect(r.progress400).toBeCloseTo(100 / 400, 12);
  });

  it('n builders at 1 + 0.5 (n - 1) times speed, to the tick', () => {
    expect(completionTick(2).tick).toBe(Math.ceil(400 / 1.5));
    expect(completionTick(3).tick).toBe(200);
    expect(completionTick(5).tick).toBe(Math.ceil(400 / 3));
    expect(completionTick(2).progress400).toBeCloseTo((100 * 1.5) / 400, 12);
  });

  it('a late builder speeds it up from the tick it arrives', () => {
    const w = world({ villagers: [{ x: 9.5, y: 10.5 }, { x: 14.5, y: 10.5 }] });
    const id = placedId(place(w, 'house', 10, 10));
    step(w, { type: 'assist', unitIds: [w.units[1]!.id], buildingId: id, queue: false });
    run(w, 30);
    expect(building(w, id).builderIds).toEqual([w.units[0]!.id, w.units[1]!.id]);
    expect(unit(w, 1).currentOrder).toMatchObject({ type: 'assist', phase: 'building' });
  });

  it('emits BuildingCompleted once, clears builders and idles the builder', () => {
    const w = world({ villagers: [{ x: 9.5, y: 10.5 }] });
    const id = placedId(place(w, 'house', 10, 10));
    run(w, 450);
    const b = building(w, id);
    expect(b.constructed).toBe(true);
    expect(b.progress).toBe(1);
    expect(b.builderIds).toEqual([]);
    expect(w.events.filter((e) => e.type === 'BuildingCompleted')).toEqual([
      { type: 'BuildingCompleted', playerId: P1, buildingId: id, buildingType: 'house' },
    ]);
    expect(unit(w).currentOrder).toBeNull();
  });

  it('instantBuild cheat completes on the first contributing tick', () => {
    const w = world({ villagers: [{ x: 9.5, y: 10.5 }] });
    w.state.players[P1]!.cheats.instantBuild = true;
    const id = placedId(place(w, 'barracks', 10, 10));
    expect(building(w, id).constructed).toBe(true);
  });

  it('walks to the site first (foundation far away)', () => {
    const w = world({ villagers: [{ x: 3.5, y: 3.5 }] });
    const id = placedId(place(w, 'house', 20, 20));
    run(w, 20);
    expect(building(w, id).progress).toBe(0);
    run(w, 1400);
    expect(building(w, id).constructed).toBe(true);
  });

  it('unfinished buildings are not counted as constructed', () => {
    const w = world({ villagers: [{ x: 3.5, y: 3.5 }] });
    const id = placedId(place(w, 'house', 20, 20));
    expect(building(w, id).constructed).toBe(false);
  });
});

describe('builders list', () => {
  it('is released on stop and when a builder is deleted', () => {
    const w = world({ villagers: [{ x: 9.5, y: 10.5 }, { x: 9.5, y: 11.5 }] });
    const id = placedId(place(w, 'house', 10, 10, false, w.units.map((u) => u.id)));
    expect(building(w, id).builderIds).toHaveLength(2);
    step(w, { type: 'stop', unitIds: [w.units[0]!.id] });
    expect(building(w, id).builderIds).toEqual([w.units[1]!.id]);
    step(w, { type: 'delete', entityIds: [w.units[1]!.id] });
    expect(building(w, id).builderIds).toEqual([]);
    const before = building(w, id).progress;
    run(w, 5);
    expect(building(w, id).progress).toBe(before);
  });

  it('a removed building target ends the order cleanly', () => {
    const w = world({ villagers: [{ x: 3.5, y: 3.5 }] });
    const id = placedId(place(w, 'house', 20, 20));
    run(w, 5);
    step(w, { type: 'delete', entityIds: [id] });
    run(w, 3);
    expect(findEntity(w.state, id)).toBeUndefined();
    expect(unit(w).currentOrder).toBeNull();
    expect(w.state.players[P1]!.resources.wood).toBe(1000);
  });
});

describe('cancelConstruction', () => {
  it('refunds exactly what was paid, frees the footprint and releases en-route builders', () => {
    mock.costOverride = { wood: 41, stone: 3 };
    try {
      const w = world({ villagers: [{ x: 3.5, y: 3.5 }] });
      const id = placedId(place(w, 'house', 20, 20));
      expect(w.state.players[P1]!.resources).toEqual({ food: 1000, wood: 959, gold: 1000, stone: 997 });
      run(w, 10);
      expect(unit(w).currentOrder).toMatchObject({ type: 'build' });
      const version = w.state.occupancyVersion;
      const events = step(w, { type: 'cancelConstruction', buildingId: id });
      expect(rejected(events)).toBeNull();
      expect(w.state.players[P1]!.resources).toEqual({ food: 1000, wood: 1000, gold: 1000, stone: 1000 });
      expect(findEntity(w.state, id)).toBeUndefined();
      expect(w.state.occupancyVersion).toBe(version + 1);
      expect(w.sim.query.canPlace(P1, 'house', 20, 20).tiles.every((t) => t === null)).toBe(true);
      expect(unit(w).currentOrder).toBeNull();
      run(w, 5);
      expect(unit(w).currentOrder).toBeNull();
    } finally {
      mock.costOverride = null;
    }
  });

  it('cancels while builders are working and keeps their queued orders', () => {
    const w = world({ villagers: [{ x: 9.5, y: 10.5 }] });
    const a = placedId(place(w, 'house', 10, 10));
    const b = placedId(place(w, 'house', 14, 10, true));
    run(w, 20);
    expect(building(w, a).builderIds).toHaveLength(1);
    step(w, { type: 'cancelConstruction', buildingId: a });
    expect(w.state.players[P1]!.resources.wood).toBe(950);
    run(w, 600);
    expect(building(w, b).constructed).toBe(true);
  });

  it('rejects finished, unknown and foreign buildings', () => {
    const w = world({
      extra: (s) => {
        createBuilding(s, 'house', P1, 10, 10, true);
      },
    });
    const done = w.state.entities.find((e) => e.kind === 'building')!;
    expect(rejected(step(w, { type: 'cancelConstruction', buildingId: done.id }))).toBe('invalidTarget');
    expect(rejected(step(w, { type: 'cancelConstruction', buildingId: 999 }))).toBe('unknownEntity');
    expect(rejected(step(w, { type: 'cancelConstruction', buildingId: w.units[0]!.id }))).toBe('invalidTarget');
  });
});

describe('assist', () => {
  it('on an unfinished building becomes an assist order; on a completed farm a gather order', () => {
    const w = world({
      villagers: [{ x: 5.5, y: 5.5 }, { x: 6.5, y: 5.5 }],
      extra: (s) => {
        createBuilding(s, 'farm', P1, 20, 20, true);
        createBuilding(s, 'house', P1, 25, 25, true);
        createBuilding(s, 'house', P1, 30, 30, false);
      },
    });
    const farm = w.state.entities.find((e) => e.kind === 'building' && e.typeId === 'farm')!;
    const house = w.state.entities.find((e) => e.kind === 'building' && e.typeId === 'house' && e.constructed)!;
    const found = w.state.entities.find((e) => e.kind === 'building' && !e.constructed)!;
    step(w, { type: 'assist', unitIds: [w.units[0]!.id], buildingId: found.id, queue: false });
    expect(w.units[0] && unit(w).currentOrder).toMatchObject({ type: 'assist', buildingId: found.id });
    expect(unit(w).orderQueue).toEqual([]);
    expect(rejected(step(w, { type: 'assist', unitIds: [w.units[1]!.id], buildingId: house.id, queue: false }))).toBe('invalidTarget');
    const u1 = w.units[1]!;
    // The gather handler is WP6's: assert on the order given, without running it.
    const ctx: SimContext = { state: w.state, runtime: rebuildRuntime(w.state, registry), data: registry, events: [] };
    applyAssistCommand(ctx, { type: 'assist', playerId: P1, seq: 99, unitIds: [u1.id], buildingId: farm.id, queue: false });
    expect(ctx.events).toEqual([]);
    expect(unit(w, 1).orderQueue).toEqual([{ type: 'gather', targetId: farm.id }]);
    expect(rejected(step(w, { type: 'assist', unitIds: [u1.id], buildingId: 999, queue: false }))).toBe('unknownEntity');
  });
});

describe('post-build auto-continue (handler level)', () => {
  function ctxOf(state: GameState): SimContext {
    return { state, runtime: rebuildRuntime(state, registry), data: registry, events: [] };
  }

  function finished(type: string, setup: (s: GameState) => void) {
    const state = createInitialState({ seed: 7, mapSize: 40, players: [{ civ: 'byzantines' }] }, registry);
    const u = createUnit(state, 'villager', P1, 5.5, 5.5);
    const b = createBuilding(state, type, P1, 10, 10, true);
    setup(state);
    u.currentOrder = { type: 'build', buildingId: b.id, phase: 'building' };
    const ctx = ctxOf(state);
    const step = buildOrderHandler.run(ctx, u, u.currentOrder as never);
    return { step, ctx, b, u };
  }

  it('lumber camp: nearest tree', () => {
    let near = 0;
    const r = finished('lumberCamp', (s) => {
      createNode(s, 'goldDeposit', 12, 12, 100);
      createNode(s, 'tree', 20, 20, 100);
      near = createNode(s, 'tree', 14, 10, 100).id;
      createNode(s, 'tree', 16, 16, 100);
    });
    expect(r.step).toEqual({ replace: { type: 'gather', targetId: near } });
  });

  it('mining camp: nearest gold or stone; mill: nearest berries', () => {
    let stone = 0;
    const m = finished('miningCamp', (s) => {
      createNode(s, 'goldDeposit', 25, 25, 100);
      stone = createNode(s, 'stoneDeposit', 13, 13, 100).id;
      createNode(s, 'tree', 12, 10, 100);
    });
    expect(m.step).toEqual({ replace: { type: 'gather', targetId: stone } });
    let berries = 0;
    const mill = finished('mill', (s) => {
      createNode(s, 'tree', 12, 10, 100);
      berries = createNode(s, 'berryBush', 18, 10, 100).id;
    });
    expect(mill.step).toEqual({ replace: { type: 'gather', targetId: berries } });
  });

  it('skips full and depleted nodes; idles when none match', () => {
    let free = 0;
    const r = finished('lumberCamp', (s) => {
      const full = createNode(s, 'tree', 12, 10, 100);
      full.gathererIds.push(999);
      createNode(s, 'tree', 13, 10, 0);
      free = createNode(s, 'tree', 22, 10, 100).id;
    });
    expect(r.step).toEqual({ replace: { type: 'gather', targetId: free } });
    const none = finished('lumberCamp', () => {});
    expect(none.step).toBe('done');
    expect(none.ctx.events).toEqual([{ type: 'VillagerIdle', playerId: P1, unitId: none.u.id }]);
  });

  it('farm: the builder works it, but only one of several', () => {
    const r = finished('farm', () => {});
    expect(r.step).toEqual({ replace: { type: 'gather', targetId: r.b.id } });
    const taken = finished('farm', (s) => {
      const other = createUnit(s, 'villager', P1, 9.5, 9.5);
      other.currentOrder = { type: 'gather', targetId: 3, phase: 'start', resource: 'food', anchor: { x: 0, y: 0 }, dropOffId: null, harvestAccumulator: 0 };
    });
    expect(taken.step).toEqual({ replace: { type: 'gather', targetId: taken.b.id } });
  });

  it('other buildings: idle with VillagerIdle, or the next queued order', () => {
    const r = finished('house', () => {});
    expect(r.step).toBe('done');
    expect(r.ctx.events).toHaveLength(1);
    const state = createInitialState({ seed: 7, mapSize: 40, players: [{ civ: 'byzantines' }] }, registry);
    const u = createUnit(state, 'villager', P1, 5.5, 5.5);
    const b = createBuilding(state, 'lumberCamp', P1, 10, 10, true);
    createNode(state, 'tree', 12, 10, 100);
    u.orderQueue = [{ type: 'move', x: 1, y: 1 }];
    u.currentOrder = { type: 'build', buildingId: b.id, phase: 'building' };
    const ctx = ctxOf(state);
    expect(buildOrderHandler.run(ctx, u, u.currentOrder as never)).toBe('done');
    expect(ctx.events).toEqual([]);
  });
});

describe('determinism', () => {
  const config = { seed: 4242, mapSize: 120, players: [{ civ: 'byzantines' }] };

  function scenario(): { sim: Sim; script: Map<number, CommandInput[]>; ids: number[] } {
    const sim = createGame(config);
    const villagers = sim.state.entities.filter((e) => e.kind === 'unit' && e.owner === P1).map((e) => e.id);
    const tc = sim.state.entities.find((e) => e.kind === 'building' && e.owner === P1)!;
    const spots: [number, number][] = [];
    if (tc.kind === 'building') {
      for (let dy = -8; dy <= 8 && spots.length < 4; dy += 3) {
        for (let dx = -8; dx <= 8 && spots.length < 4; dx += 3) {
          const tx = tc.tile.tx + dx;
          const ty = tc.tile.ty + dy;
          if (sim.query.canPlace(P1, 'house', tx, ty).ok && !spots.some(([x, y]) => Math.abs(x - tx) < 3 && Math.abs(y - ty) < 3)) spots.push([tx, ty]);
        }
      }
    }
    expect(spots.length).toBeGreaterThanOrEqual(3);
    const mk = (i: number, queue: boolean): CommandInput => ({
      type: 'build',
      unitIds: [villagers[i % villagers.length]!, villagers[(i + 1) % villagers.length]!],
      buildingType: 'house',
      tx: spots[i]![0],
      ty: spots[i]![1],
      queue,
    });
    const script = new Map<number, CommandInput[]>([
      [1, [mk(0, false)]],
      [5, [mk(1, true), mk(2, true)]],
      [40, [{ type: 'assist', unitIds: [villagers[3]!], buildingId: 0, queue: false }]],
    ]);
    return { sim, script, ids: villagers };
  }

  function drive(sim: Sim, script: Map<number, CommandInput[]>, from: number, to: number, seqRef: { n: number }): void {
    for (let t = from; t < to; t++) {
      const inputs = script.get(t) ?? [];
      sim.step(inputs.map((i) => ({ ...i, playerId: P1, seq: seqRef.n++ }) as Command));
    }
  }

  it('same commands give identical hashes, also across save and load', () => {
    const a = scenario();
    const b = scenario();
    const seqA = { n: 1 };
    const seqB = { n: 1 };
    drive(a.sim, a.script, 1, 700, seqA);
    drive(b.sim, b.script, 1, 700, seqB);
    expect(hashState(a.sim.state)).toBe(hashState(b.sim.state));
    expect(a.sim.state.entities.filter((e) => e.kind === 'building' && e.owner === P1 && e.typeId === 'house' && e.constructed).length).toBeGreaterThan(0);

    // Save and load midway through, then continue: same hash as the uninterrupted run.
    const c = scenario();
    const seqC = { n: 1 };
    drive(c.sim, c.script, 1, 200, seqC);
    const loaded = deserialize(serialize(c.sim));
    expect(hashState(loaded.state)).toBe(hashState(c.sim.state));
    drive(loaded, c.script, 200, 700, seqC);
    expect(hashState(loaded.state)).toBe(hashState(a.sim.state));
  });
});
