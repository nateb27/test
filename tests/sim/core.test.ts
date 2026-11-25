import { describe, expect, it } from 'vitest';
import { createGame, deserialize, hashState, serialize } from '../../src/sim';
import { sortCommands } from '../../src/sim/systems/commands';
import { addEntity, allocateEntityId, createNode, createUnit, entityIndex, findEntity, removeEntities } from '../../src/sim/entities';
import { buildOccupancy } from '../../src/sim/map/occupancy';
import { MAP_SIZE, UNIT_PICK_RADIUS, type BuildingEntity, type Command, type GameState, type ResourceNodeEntity } from '../../src/sim/types';
import { configFor, fixtureData, generate } from './fixtures';

const mutable = (s: unknown): GameState => s as GameState;

function newGame(seed = 11, players = 1) {
  return createGame(configFor(seed, players), fixtureData);
}

function scriptedCommands(tick: number): Command[] {
  const cmds: Command[] = [];
  if (tick % 40 === 0) {
    cmds.push({ type: 'cheat', playerId: 1, seq: tick + 1, cheat: { kind: 'addResources', amounts: { gold: 7 } } });
  }
  if (tick % 60 === 0) {
    cmds.push({ type: 'cheat', playerId: 1, seq: tick + 2, cheat: { kind: 'spawnUnit', unitType: 'villager', x: 60.5, y: 60.5 } });
  }
  if (tick === 100) cmds.push({ type: 'delete', playerId: 1, seq: 500, entityIds: [2] });
  return cmds;
}

describe('determinism and save/load', () => {
  it('same seed and commands give identical hashes every 100 ticks', () => {
    const a = newGame();
    const b = newGame();
    for (let t = 0; t < 600; t++) {
      a.step(scriptedCommands(t));
      b.step(scriptedCommands(t));
      if ((t + 1) % 100 === 0) expect(hashState(a.state)).toBe(hashState(b.state));
    }
    expect(a.state.tick).toBe(600);
    expect(serialize(a)).toBe(serialize(b));
  });

  it('a save/load in the middle continues identically to an uninterrupted run', () => {
    const straight = newGame(21);
    const resumed = newGame(21);
    for (let t = 0; t < 150; t++) {
      straight.step(scriptedCommands(t));
      resumed.step(scriptedCommands(t));
    }
    const loaded = deserialize(serialize(resumed), fixtureData);
    expect(hashState(loaded.state)).toBe(hashState(straight.state));
    expect(loaded.state.tick).toBe(150);
    for (let t = 150; t < 400; t++) {
      straight.step(scriptedCommands(t));
      loaded.step(scriptedCommands(t));
      if ((t + 1) % 50 === 0) expect(hashState(loaded.state)).toBe(hashState(straight.state));
    }
    expect(serialize(loaded)).toBe(serialize(straight));
  });

  it('rebuilds occupancy on load (the grid is not part of the save)', () => {
    const sim = newGame(3);
    const json = serialize(sim);
    expect(json).not.toContain('"occupancy"');
    const loaded = deserialize(json, fixtureData);
    expect(buildOccupancy(mutable(loaded.state), fixtureData)).toEqual(buildOccupancy(mutable(sim.state), fixtureData));
  });

  it('stores only canonical JSON values (no NaN, -0, Infinity, undefined)', () => {
    expect(() => serialize(newGame(5, 2))).not.toThrow();
  });
});

describe('entity store', () => {
  it('allocates increasing ids and keeps entities sorted', () => {
    const state = mutable(newGame().state);
    const before = state.entities.length;
    const u = createUnit(state, 'villager', 1, 3.5, 3.5);
    const n = createNode(state, 'tree', 2, 2, 100);
    expect(n.id).toBeGreaterThan(u.id);
    expect(state.entities).toHaveLength(before + 2);
    expect(findEntity(state, u.id)).toBe(u);
    expect(entityIndex(state.entities, n.id)).toBe(state.entities.length - 1);
    expect(findEntity(state, 9_999_999)).toBeUndefined();
  });

  it('refuses out-of-order appends', () => {
    const state = mutable(newGame().state);
    const last = state.entities[state.entities.length - 1]!;
    expect(() => addEntity(state, { ...last })).toThrow();
  });

  it('never reuses ids after removal', () => {
    const state = mutable(newGame().state);
    const id = allocateEntityId(state);
    const next = state.nextEntityId;
    removeEntities(state, [state.entities[0]!.id]);
    expect(allocateEntityId(state)).toBe(next);
    expect(next).toBeGreaterThan(id);
    expect(state.entities.every((e, i, all) => i === 0 || e.id > all[i - 1]!.id)).toBe(true);
  });
});

describe('occupancy', () => {
  it('blocks the Town Center and nodes but not units', () => {
    const sim = newGame(4);
    const state = mutable(sim.state);
    const w = state.map.width;
    const occ = buildOccupancy(state, fixtureData);
    const tc = state.entities.find((e) => e.kind === 'building') as BuildingEntity;
    for (let y = tc.tile.ty; y < tc.tile.ty + 4; y++) {
      for (let x = tc.tile.tx; x < tc.tile.tx + 4; x++) expect(occ[y * w + x]).toBe(1);
    }
    let blocked = 0;
    for (const v of occ) blocked += v;
    const expected = state.entities.reduce((n, e) => {
      if (e.kind === 'unit') return n;
      const size = (fixtureData.def(e.typeId) as { footprint: number }).footprint;
      return n + size * size;
    }, 0);
    expect(blocked).toBe(expected);
    for (const u of state.entities.filter((e) => e.kind === 'unit')) {
      if (u.kind === 'unit') expect(occ[Math.floor(u.pos.y) * w + Math.floor(u.pos.x)]).toBe(0);
    }
  });

  it('matches the cached runtime grid after generation and after steps', () => {
    const sim = newGame(8);
    for (let i = 0; i < 5; i++) sim.step([]);
    const fresh = deserialize(serialize(sim), fixtureData);
    expect(hashState(fresh.state)).toBe(hashState(sim.state));
  });
});

describe('command intake', () => {
  it('sorts by playerId then seq, stably', () => {
    const mk = (playerId: number, seq: number): Command => ({ type: 'stop', playerId, seq, unitIds: [1] });
    const sorted = sortCommands([mk(2, 1), mk(1, 5), mk(1, 2), mk(1, 5)]);
    expect(sorted.map((c) => [c.playerId, c.seq])).toEqual([
      [1, 2],
      [1, 5],
      [1, 5],
      [2, 1],
    ]);
  });

  it('applies commands in (playerId, seq) order regardless of arrival order', () => {
    const sim = newGame(2, 2);
    const events = sim.step([
      { type: 'bogus', playerId: 2, seq: 9 } as unknown as Command,
      { type: 'bogus', playerId: 1, seq: 3 } as unknown as Command,
      { type: 'bogus', playerId: 1, seq: 1 } as unknown as Command,
    ]);
    expect(events.map((e) => (e.type === 'CommandRejected' ? [e.playerId, e.seq] : null))).toEqual([
      [1, 1],
      [1, 3],
      [2, 9],
    ]);
  });

  it.each([
    ['unknown type', { type: 'dance', playerId: 1, seq: 1 }],
    ['neutral player', { type: 'stop', playerId: 0, seq: 1, unitIds: [1] }],
    ['player out of range', { type: 'stop', playerId: 7, seq: 1, unitIds: [1] }],
    ['fractional seq', { type: 'stop', playerId: 1, seq: 1.5, unitIds: [1] }],
    ['empty id list', { type: 'stop', playerId: 1, seq: 1, unitIds: [] }],
    ['non-integer id', { type: 'stop', playerId: 1, seq: 1, unitIds: [1.5] }],
    ['NaN coordinate', { type: 'move', playerId: 1, seq: 1, unitIds: [1], x: Number.NaN, y: 3, queue: false }],
    ['Infinity coordinate', { type: 'move', playerId: 1, seq: 1, unitIds: [1], x: 3, y: Infinity, queue: false }],
    ['missing queue flag', { type: 'gather', playerId: 1, seq: 1, unitIds: [1], nodeId: 2 }],
    ['build without type', { type: 'build', playerId: 1, seq: 1, unitIds: [1], tx: 1, ty: 1, queue: false }],
    ['negative id', { type: 'delete', playerId: 1, seq: 1, entityIds: [-4] }],
    ['unknown cheat', { type: 'cheat', playerId: 1, seq: 1, cheat: { kind: 'fly' } }],
    ['cheat NaN amount', { type: 'cheat', playerId: 1, seq: 1, cheat: { kind: 'addResources', amounts: { food: Number.NaN } } }],
  ])('rejects malformed command: %s', (_name, cmd) => {
    const sim = newGame();
    const before = hashState(sim.state);
    const events = sim.step([cmd as unknown as Command]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'CommandRejected', reason: 'invalidCommand' });
    // Only the tick counter changed.
    const after = mutable(JSON.parse(JSON.stringify(sim.state)));
    after.tick = 0;
    expect(hashState(after)).toBe(before);
  });

  it('applies a cheat command after the shape check', () => {
    const sim = newGame();
    const events = sim.step([{ type: 'cheat', playerId: 1, seq: 1, cheat: { kind: 'addResources', amounts: { stone: 5 } } }]);
    expect(events).toEqual([]);
    expect(sim.state.players[1]!.resources.stone).toBe(5);
  });

  it('spawnUnit cheat creates a unit and rejects unknown types and blocked tiles', () => {
    const sim = newGame(6);
    const state = sim.state;
    const spawn = (unitType: string, x: number, y: number) =>
      sim.step([{ type: 'cheat', playerId: 1, seq: state.tick + 1, cheat: { kind: 'spawnUnit', unitType, x, y } }]);
    const before = state.entities.length;
    expect(spawn('villager', 60.5, 60.5)).toEqual([]);
    expect(state.entities).toHaveLength(before + 1);
    expect(spawn('nope', 60.5, 60.5)[0]).toMatchObject({ reason: 'unknownDef' });
    const tc = state.entities.find((e) => e.kind === 'building') as BuildingEntity;
    expect(spawn('villager', tc.tile.tx + 1.5, tc.tile.ty + 1.5)[0]).toMatchObject({ reason: 'invalidTarget' });
    expect(spawn('villager', -3, 5)[0]).toMatchObject({ reason: 'invalidTarget' });
    expect(state.entities).toHaveLength(before + 1);
  });
});

describe('delete command and cleanup', () => {
  it('removes a deleted unit and releases it from node gatherer lists', () => {
    const sim = newGame(7);
    const state = mutable(sim.state);
    const unit = state.entities.find((e) => e.kind === 'unit')!;
    const node = state.entities.find((e) => e.kind === 'node') as ResourceNodeEntity;
    node.gathererIds.push(unit.id);
    const events = sim.step([{ type: 'delete', playerId: 1, seq: 1, entityIds: [unit.id] }]);
    expect(events).toEqual([]);
    expect(sim.query.entityById(unit.id)).toBeUndefined();
    expect(node.gathererIds).toEqual([]);
  });

  it('rejects deleting unknown, foreign and neutral entities without changing anything', () => {
    const sim = newGame(7, 2);
    const state = mutable(sim.state);
    const p2unit = state.entities.find((e) => e.kind === 'unit' && e.owner === 2)!;
    const p1unit = state.entities.find((e) => e.kind === 'unit' && e.owner === 1)!;
    const node = state.entities.find((e) => e.kind === 'node')!;
    const count = state.entities.length;
    const reasons = sim
      .step([
        { type: 'delete', playerId: 1, seq: 1, entityIds: [9_999_999] },
        { type: 'delete', playerId: 1, seq: 2, entityIds: [p2unit.id] },
        { type: 'delete', playerId: 1, seq: 3, entityIds: [node.id] },
        { type: 'delete', playerId: 1, seq: 4, entityIds: [p1unit.id, p2unit.id] },
      ])
      .map((e) => (e.type === 'CommandRejected' ? e.reason : e.type));
    expect(reasons).toEqual(['unknownEntity', 'notOwner', 'notOwner', 'notOwner']);
    expect(state.entities).toHaveLength(count);
  });

  it('frees the footprint and bumps occupancyVersion when a building is deleted', () => {
    const sim = newGame(9);
    const state = mutable(sim.state);
    const tc = state.entities.find((e) => e.kind === 'building') as BuildingEntity;
    const version = state.occupancyVersion;
    sim.step([{ type: 'delete', playerId: 1, seq: 1, entityIds: [tc.id] }]);
    expect(state.occupancyVersion).toBe(version + 1);
    expect(sim.query.entityById(tc.id)).toBeUndefined();
    const occ = buildOccupancy(state, fixtureData);
    expect(occ[tc.tile.ty * state.map.width + tc.tile.tx]).toBe(0);
  });

  it('refunds an unfinished building in full when deleted', () => {
    const sim = newGame(9);
    const state = mutable(sim.state);
    const foundation: BuildingEntity = {
      ...(state.entities.find((e) => e.kind === 'building') as BuildingEntity),
      id: state.nextEntityId++,
      tile: { tx: 5, ty: 5 },
      constructed: false,
      progress: 0.2,
      costPaid: { food: 0, wood: 50, gold: 0, stone: 0 },
    };
    state.entities.push(foundation);
    const wood = state.players[1]!.resources.wood;
    sim.step([{ type: 'delete', playerId: 1, seq: 1, entityIds: [foundation.id] }]);
    expect(state.players[1]!.resources.wood).toBe(wood + 50);
    expect(sim.query.entityById(foundation.id)).toBeUndefined();
  });

  it('removes depleted nodes, emits ResourceNodeDepleted and unblocks the tile', () => {
    const sim = newGame(10);
    const state = mutable(sim.state);
    const node = state.entities.find((e) => e.kind === 'node' && e.typeId === 'goldDeposit') as ResourceNodeEntity;
    const w = state.map.width;
    node.amount = 0;
    const version = state.occupancyVersion;
    const events = sim.step([]);
    expect(events).toEqual([
      {
        type: 'ResourceNodeDepleted',
        nodeId: node.id,
        nodeType: 'goldDeposit',
        resource: 'gold',
        x: node.tile.tx + 1,
        y: node.tile.ty + 1,
      },
    ]);
    expect(sim.query.entityById(node.id)).toBeUndefined();
    expect(state.occupancyVersion).toBe(version + 1);
    expect(buildOccupancy(state, fixtureData)[node.tile.ty * w + node.tile.tx]).toBe(0);
  });
});

describe('queries', () => {
  it('entityById finds entities and misses unknown ids', () => {
    const sim = newGame();
    expect(sim.query.entityById(1)?.kind).toBe('building');
    expect(sim.query.entityById(0)).toBeUndefined();
  });

  it('entitiesInRect returns ascending ids and accepts any corner order', () => {
    const sim = newGame(12);
    const state = sim.state;
    const tc = state.entities.find((e) => e.kind === 'building') as BuildingEntity;
    const a = sim.query.entitiesInRect(tc.tile.tx - 3, tc.tile.ty - 3, tc.tile.tx + 7, tc.tile.ty + 7);
    const b = sim.query.entitiesInRect(tc.tile.tx + 7, tc.tile.ty + 7, tc.tile.tx - 3, tc.tile.ty - 3);
    expect(a.map((e) => e.id)).toEqual(b.map((e) => e.id));
    expect(a.map((e) => e.id)).toEqual([...a.map((e) => e.id)].sort((x, y) => x - y));
    expect(a.some((e) => e.id === tc.id)).toBe(true);
    expect(a.filter((e) => e.kind === 'unit')).toHaveLength(6);
    expect(sim.query.entitiesInRect(0, 0, 0.5, 0.5)).toEqual([]);
  });

  it('entitiesInRect uses the pick radius for units and footprints for buildings', () => {
    const sim = newGame(12);
    const state = mutable(sim.state);
    const unit = createUnit(state, 'villager', 1, 50.5, 50.5);
    expect(sim.query.entitiesInRect(50.5 + UNIT_PICK_RADIUS - 0.01, 50.5, 60, 60).map((e) => e.id)).toContain(unit.id);
    expect(sim.query.entitiesInRect(50.5 + UNIT_PICK_RADIUS + 0.01, 50.5, 60, 60).map((e) => e.id)).not.toContain(unit.id);
    const tc = state.entities.find((e) => e.kind === 'building') as BuildingEntity;
    // Touching the far edge of the footprint (exclusive) does not hit it.
    expect(sim.query.entitiesInRect(tc.tile.tx + 4, tc.tile.ty + 1, tc.tile.tx + 5, tc.tile.ty + 2).map((e) => e.id)).not.toContain(tc.id);
    expect(sim.query.entitiesInRect(tc.tile.tx + 3.9, tc.tile.ty + 1, tc.tile.tx + 5, tc.tile.ty + 2).map((e) => e.id)).toContain(tc.id);
  });

  it('entityAtPoint prefers units, then buildings, then nodes; nearest unit wins, ties by id', () => {
    const sim = newGame(13);
    const state = mutable(sim.state);
    const tc = state.entities.find((e) => e.kind === 'building') as BuildingEntity;
    const cx = tc.tile.tx + 2;
    const cy = tc.tile.ty + 2;
    expect(sim.query.entityAtPoint(cx, cy)?.id).toBe(tc.id);
    const far = createUnit(state, 'villager', 1, cx + 0.3, cy);
    expect(sim.query.entityAtPoint(cx, cy)?.id).toBe(far.id);
    const near = createUnit(state, 'villager', 1, cx + 0.1, cy);
    expect(sim.query.entityAtPoint(cx, cy)?.id).toBe(near.id);
    // Equal distance: lowest id.
    const twinA = createUnit(state, 'villager', 1, 90.5, 90.5);
    createUnit(state, 'villager', 1, 90.5, 90.5);
    expect(sim.query.entityAtPoint(90.5, 90.5)?.id).toBe(twinA.id);
    const node = state.entities.find((e) => e.kind === 'node')!;
    if (node.kind === 'node') expect(sim.query.entityAtPoint(node.tile.tx + 0.5, node.tile.ty + 0.5)?.id).toBe(node.id);
    expect(sim.query.entityAtPoint(0.01, 0.01)).toBeUndefined();
  });
});

describe('map seed retry', () => {
  it('uses seed+k when earlier seeds fail validation, deterministically', () => {
    // Small maps with several players fail validation often enough to exercise the retry.
    let retried: { seed: number; attempts: number; mapSeed: number } | null = null;
    for (let seed = 1; seed <= 200 && retried === null; seed++) {
      const { report } = generate(seed, 4, 64);
      if (report.attempts > 1) retried = { seed, attempts: report.attempts, mapSeed: report.mapSeed };
    }
    expect(retried).not.toBeNull();
    const r = retried!;
    expect(r.mapSeed).toBe(r.seed + r.attempts - 1);
    const sim = createGame(configFor(r.seed, 4, 64), fixtureData);
    expect(sim.state.seed).toBe(r.seed);
    expect(sim.state.mapSeed).toBe(r.mapSeed);
    // The retried map equals a direct generation from the final seed.
    const direct = createGame(configFor(r.mapSeed, 4, 64), fixtureData);
    expect(direct.state.entities).toEqual(sim.state.entities);
  });

  it('exposes MAP_SIZE-sized state for the default config', () => {
    expect(newGame().state.map.width).toBe(MAP_SIZE);
  });
});
