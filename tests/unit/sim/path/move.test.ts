import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../../../../src/sim/hash';
import { followPath } from '../../../../src/sim/path/follow';
import { gridOf } from '../../../../src/sim/path/grid';
import { computePath, processPathQueue, requestPath } from '../../../../src/sim/path/queue';
import { facingFromDelta, runMovement, unitSpeed } from '../../../../src/sim/systems/movement';
import { applyStopCommand, assignOrder } from '../../../../src/sim/systems/orders/index';
import { applyMoveCommand } from '../../../../src/sim/systems/orders/move';
import { SEPARATION_RADIUS, TICK_RATE, type UnitEntity } from '../../../../src/sim/types';
import { addUnit, makeCtx, makeState, moveCmd, setBlocked, step, TEST_SPEED } from './helpers';
import type { GameState } from '../../../../src/sim/types';

function setup(width = 20, height = 20) {
  const state = makeState(width, height);
  const ctx = makeCtx(state, new Uint8Array(width * height));
  return { state, ctx };
}

function runUntilIdle(ctx: ReturnType<typeof setup>['ctx'], maxTicks: number, onTick?: () => void): number {
  for (let t = 0; t < maxTicks; t++) {
    step(ctx);
    onTick?.();
    const busy = ctx.state.entities.some(
      (e) => e.kind === 'unit' && (e.currentOrder !== null || e.orderQueue.length > 0 || e.path !== null),
    );
    if (!busy) return t + 1;
  }
  return -1;
}

describe('facing', () => {
  it('maps deltas to 8 directions without trigonometry', () => {
    expect(facingFromDelta(1, 0)).toBe(0);
    expect(facingFromDelta(1, 1)).toBe(1);
    expect(facingFromDelta(0, 1)).toBe(2);
    expect(facingFromDelta(-1, 1)).toBe(3);
    expect(facingFromDelta(-1, 0)).toBe(4);
    expect(facingFromDelta(-1, -1)).toBe(5);
    expect(facingFromDelta(0, -1)).toBe(6);
    expect(facingFromDelta(1, -1)).toBe(7);
    expect(facingFromDelta(1, 0.3)).toBe(0);
    expect(facingFromDelta(1, 0.5)).toBe(1);
    expect(facingFromDelta(-0.2, -1)).toBe(6);
    expect(facingFromDelta(0, 0)).toBeNull();
  });
});

describe('move command and order', () => {
  it('walks a unit to the exact point at its speed and then idles', () => {
    const { state, ctx } = setup();
    const u = addUnit(state, 1, 2.5, 2.5);
    expect(unitSpeed(ctx, u)).toBe(TEST_SPEED);
    step(ctx, [moveCmd(1, [u.id], 12.25, 2.75)]);
    // Command applied, order begun, path served and first movement all in the same tick.
    expect(u.pos.x).toBeGreaterThan(2.5);
    const moved = Math.sqrt((u.pos.x - u.prevPos.x) ** 2 + (u.pos.y - u.prevPos.y) ** 2);
    expect(moved).toBeCloseTo(TEST_SPEED / TICK_RATE, 10);
    expect(u.facing).toBe(0);
    const ticks = runUntilIdle(ctx, 200);
    expect(ticks).toBeGreaterThan(0);
    expect(u.pos).toEqual({ x: 12.25, y: 2.75 });
    expect(u.currentOrder).toBeNull();
    expect(u.path).toBeNull();
    expect(() => canonicalJson(state)).not.toThrow();
  });

  it('routes around walls without entering blocked tiles', () => {
    const { state, ctx } = setup();
    for (let y = 0; y < 18; y++) ctx.runtime.occupancy[y * 20 + 10] = 1;
    const u = addUnit(state, 1, 2.5, 2.5);
    step(ctx, [moveCmd(1, [u.id], 17.5, 2.5)]);
    const ticks = runUntilIdle(ctx, 500, () => {
      expect(ctx.runtime.occupancy[Math.floor(u.pos.y) * 20 + Math.floor(u.pos.x)]).toBe(0);
    });
    expect(ticks).toBeGreaterThan(0);
    expect(u.pos).toEqual({ x: 17.5, y: 2.5 });
  });

  it('shift-queues moves and runs them in order', () => {
    const { state, ctx } = setup();
    const u = addUnit(state, 1, 1.5, 1.5);
    step(ctx, [moveCmd(1, [u.id], 5.5, 1.5), moveCmd(1, [u.id], 5.5, 6.5, true)]);
    expect(u.orderQueue).toEqual([{ type: 'move', x: 5.5, y: 6.5 }]);
    runUntilIdle(ctx, 300);
    expect(u.pos).toEqual({ x: 5.5, y: 6.5 });
    // A non-queued move replaces queue and current order.
    step(ctx, [moveCmd(1, [u.id], 1.5, 1.5), moveCmd(1, [u.id], 9.5, 9.5, true)]);
    step(ctx, [moveCmd(1, [u.id], 3.5, 3.5)]);
    expect(u.orderQueue).toEqual([]);
    runUntilIdle(ctx, 300);
    expect(u.pos).toEqual({ x: 3.5, y: 3.5 });
  });

  it('stop clears orders and the unit stays put', () => {
    const { state, ctx } = setup();
    const u = addUnit(state, 1, 1.5, 1.5);
    step(ctx, [moveCmd(1, [u.id], 15.5, 1.5)]);
    step(ctx);
    const x = u.pos.x;
    applyStopCommand(ctx, { type: 'stop', playerId: 1, seq: 99, unitIds: [u.id] });
    expect(u.currentOrder).toBeNull();
    expect(u.path).toBeNull();
    step(ctx);
    expect(u.pos.x).toBe(x);
  });

  it('rejects unknown, foreign and non-unit ids atomically, and bad coordinates', () => {
    const { state, ctx } = setup();
    const mine = addUnit(state, 1, 1.5, 1.5);
    const theirs = addUnit(state, 2, 3.5, 1.5);
    const cases: [number[], string][] = [
      [[mine.id, 999], 'unknownEntity'],
      [[mine.id, theirs.id], 'notOwner'],
    ];
    for (const [ids, reason] of cases) {
      ctx.events = [];
      applyMoveCommand(ctx, { type: 'move', playerId: 1, seq: 1, unitIds: ids, x: 5, y: 5, queue: false });
      expect(ctx.events).toEqual([
        { type: 'CommandRejected', playerId: 1, seq: 1, commandType: 'move', reason },
      ]);
      expect(mine.orderQueue).toEqual([]);
    }
    state.entities.push({
      id: state.nextEntityId++,
      kind: 'node',
      owner: 1,
      typeId: 'tree',
      tile: { tx: 9, ty: 9 },
      amount: 100,
      gathererIds: [],
    });
    ctx.events = [];
    applyMoveCommand(ctx, { type: 'move', playerId: 1, seq: 2, unitIds: [state.nextEntityId - 1], x: 1, y: 1, queue: false });
    expect(ctx.events[0]).toMatchObject({ reason: 'cannotPerform' });
    ctx.events = [];
    applyMoveCommand(ctx, { type: 'move', playerId: 1, seq: 3, unitIds: [mine.id], x: Number.NaN, y: 1, queue: false });
    expect(ctx.events[0]).toMatchObject({ reason: 'invalidCommand' });
    ctx.events = [];
    applyStopCommand(ctx, { type: 'stop', playerId: 2, seq: 1, unitIds: [mine.id] });
    expect(ctx.events[0]).toMatchObject({ reason: 'notOwner', commandType: 'stop' });
  });

  it('sends a group to distinct slots, nearest unit to the clicked point', () => {
    const { state, ctx } = setup(30, 30);
    const units: UnitEntity[] = [];
    for (let i = 0; i < 12; i++) units.push(addUnit(state, 1, 2.5 + (i % 4), 2.5 + Math.floor(i / 4)));
    step(ctx, [moveCmd(1, units.map((u) => u.id), 20.5, 20.5)]);
    runUntilIdle(ctx, 600);
    const tiles = new Set(units.map((u) => `${Math.floor(u.pos.x)},${Math.floor(u.pos.y)}`));
    expect(tiles.size).toBe(12);
    // The unit nearest the target (largest x+y start: id of index 11) took the clicked point.
    expect(units[11]!.pos).toEqual({ x: 20.5, y: 20.5 });
    for (const u of units) {
      expect(Math.abs(u.pos.x - 20.5)).toBeLessThanOrEqual(3);
      expect(Math.abs(u.pos.y - 20.5)).toBeLessThanOrEqual(3);
    }
  });

  it('moves to the nearest reachable tile when the target is walled off', () => {
    const { state, ctx } = setup(12, 12);
    for (let i = 6; i < 12; i++) {
      ctx.runtime.occupancy[6 * 12 + i] = 1;
      ctx.runtime.occupancy[i * 12 + 6] = 1;
    }
    const u = addUnit(state, 1, 1.5, 1.5);
    step(ctx, [moveCmd(1, [u.id], 9.5, 9.5)]);
    expect(runUntilIdle(ctx, 300)).toBeGreaterThan(0);
    // Nearest reachable tiles by octile distance to (9,9) are (9,5) and (5,9); equal
    // path cost, so the lower tile index wins.
    expect(u.pos).toEqual({ x: 9.5, y: 5.5 });
  });
});

describe('stale paths', () => {
  it('re-paths when a blocker appears on the path and still arrives', () => {
    const { state, ctx } = setup(20, 20);
    const u = addUnit(state, 1, 1.5, 10.5);
    step(ctx, [moveCmd(1, [u.id], 18.5, 10.5)]);
    expect(u.path?.waypoints).toEqual([{ x: 18.5, y: 10.5 }]);
    step(ctx);
    // Drop a wall across the straight line (with a gap at the top).
    for (let y = 3; y < 20; y++) setBlocked(ctx, 10, y, 1);
    const requestsBefore = state.nextPathRequestId;
    const ticks = runUntilIdle(ctx, 600, () => {
      expect(ctx.runtime.occupancy[Math.floor(u.pos.y) * 20 + Math.floor(u.pos.x)]).toBe(0);
    });
    expect(ticks).toBeGreaterThan(0);
    expect(state.nextPathRequestId).toBe(requestsBefore + 1);
    expect(u.pos).toEqual({ x: 18.5, y: 10.5 });
  });

  it('keeps a path whose remaining segments are still clear', () => {
    const { state, ctx } = setup(20, 20);
    const u = addUnit(state, 1, 1.5, 10.5);
    step(ctx, [moveCmd(1, [u.id], 18.5, 10.5)]);
    setBlocked(ctx, 5, 2, 1); // far from the path
    const before = state.nextPathRequestId;
    step(ctx);
    expect(state.nextPathRequestId).toBe(before);
    expect(u.path?.occupancyVersion).toBe(state.occupancyVersion);
  });

  it('lets a unit walk off a tile that became blocked under it', () => {
    const { state, ctx } = setup(10, 10);
    const u = addUnit(state, 1, 4.5, 4.5);
    assignOrder(ctx, u, { type: 'move', x: 8.5, y: 4.5 }, false);
    setBlocked(ctx, 4, 4, 1);
    expect(runUntilIdle(ctx, 200)).toBeGreaterThan(0);
    expect(u.pos).toEqual({ x: 8.5, y: 4.5 });
  });

  it('followPath reports waiting, moving and arrived', () => {
    const { state, ctx } = setup(10, 10);
    const u = addUnit(state, 1, 1.5, 1.5);
    const goal = { kind: 'point', x: 1.5, y: 1.5 } as const;
    expect(followPath(ctx, u, goal)).toBe('waiting');
    expect(followPath(ctx, u, goal)).toBe('waiting');
    requestPath(ctx, u, goal); // replaces the outstanding request
    expect(state.pathQueue).toHaveLength(2);
    step(ctx);
    expect(state.pathQueue).toHaveLength(0);
    expect(followPath(ctx, u, goal)).toBe('arrived');
  });
});

describe('path queue budget', () => {
  it('serves requests whole and in order, deferring what does not fit', () => {
    const { state, ctx } = setup(40, 40);
    for (let y = 0; y < 39; y++) ctx.runtime.occupancy[y * 40 + 20] = 1;
    const a = addUnit(state, 1, 1.5, 1.5);
    const b = addUnit(state, 1, 1.5, 2.5);
    const c = addUnit(state, 1, 1.5, 3.5);
    requestPath(ctx, a, { kind: 'point', x: 38.5, y: 1.5 });
    requestPath(ctx, b, { kind: 'point', x: 38.5, y: 2.5 });
    requestPath(ctx, c, { kind: 'point', x: 2.5, y: 3.5 });
    // Measure one long search, then give a budget that fits it but not the second.
    const one = computePath(gridOf(ctx), { tx: 1, ty: 1 }, { kind: 'point', x: 38.5, y: 1.5 }).expanded;
    expect(one).toBeGreaterThan(100);
    // A first search that hits the cap still serves its request (best partial path).
    const probeState = JSON.parse(JSON.stringify(state)) as GameState;
    const probe = makeCtx(probeState, new Uint8Array(ctx.runtime.occupancy));
    expect(processPathQueue(probe, 10)).toBe(10);
    expect(probeState.pathQueue).toHaveLength(2);
    const used = processPathQueue(ctx, one + 5);
    expect(used).toBeLessThanOrEqual(one + 5);
    expect(a.path).not.toBeNull();
    expect(b.path).toBeNull();
    expect(b.pendingPathRequestId).not.toBeNull();
    expect(c.path).toBeNull(); // FIFO: c waits behind b even though it is cheap
    expect(state.pathQueue.map((r) => r.unitId)).toEqual([b.id, c.id]);
    processPathQueue(ctx);
    expect(b.path?.waypoints[b.path.waypoints.length - 1]).toEqual({ x: 38.5, y: 2.5 });
    expect(c.path?.waypoints).toEqual([{ x: 2.5, y: 3.5 }]);
    expect(state.pathQueue).toHaveLength(0);
  });

  it('drops requests of removed units and superseded requests', () => {
    const { state, ctx } = setup(10, 10);
    const a = addUnit(state, 1, 1.5, 1.5);
    requestPath(ctx, a, { kind: 'point', x: 5.5, y: 5.5 });
    requestPath(ctx, a, { kind: 'point', x: 8.5, y: 8.5 });
    const b = addUnit(state, 1, 2.5, 2.5);
    requestPath(ctx, b, { kind: 'point', x: 5.5, y: 5.5 });
    state.entities = state.entities.filter((e) => e.id !== b.id);
    processPathQueue(ctx);
    expect(state.pathQueue).toHaveLength(0);
    expect(a.path?.waypoints).toEqual([{ x: 8.5, y: 8.5 }]);
  });
});

describe('separation', () => {
  it('pushes apart idle units closer than the radius, deterministically', () => {
    const { state, ctx } = setup(10, 10);
    const a = addUnit(state, 1, 5.5, 5.5);
    const b = addUnit(state, 1, 5.5, 5.5);
    const c = addUnit(state, 1, 5.6, 5.5);
    const far = addUnit(state, 1, 1.5, 1.5);
    for (let i = 0; i < 40; i++) runMovement(ctx);
    const units = [a, b, c];
    for (let i = 0; i < units.length; i++)
      for (let j = i + 1; j < units.length; j++) {
        const dx = units[i]!.pos.x - units[j]!.pos.x;
        const dy = units[i]!.pos.y - units[j]!.pos.y;
        expect(Math.sqrt(dx * dx + dy * dy)).toBeGreaterThan(SEPARATION_RADIUS - 0.01);
      }
    expect(far.pos).toEqual({ x: 1.5, y: 1.5 });
    expect(() => canonicalJson(state)).not.toThrow();
  });

  it('does not push moving units', () => {
    const { state, ctx } = setup(10, 10);
    const a = addUnit(state, 1, 5.5, 5.5);
    const b = addUnit(state, 1, 5.5, 5.5);
    a.path = { waypoints: [{ x: 5.5, y: 5.5 }], nextIndex: 1, occupancyVersion: 0 };
    a.currentOrder = { type: 'move', x: 5.5, y: 5.5, phase: 'walking' };
    b.path = { waypoints: [{ x: 5.5, y: 5.5 }], nextIndex: 1, occupancyVersion: 0 };
    b.currentOrder = { type: 'move', x: 5.5, y: 5.5, phase: 'walking' };
    runMovement(ctx);
    expect(a.pos).toEqual(b.pos);
  });
});
