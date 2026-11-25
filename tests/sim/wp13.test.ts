/** WP13 rule changes: last Town Center, spawn spreading, rally retarget, population counter, edge cases. */

import { describe, expect, it } from 'vitest';
import { createNode, createUnit, findEntity } from '../../src/sim/entities';
import { applyCommands } from '../../src/sim/systems/commands';
import { runCleanup } from '../../src/sim/systems/cleanup';
import { runProduction } from '../../src/sim/systems/production';
import type { CommandInput, SimContext, SimEvent, UnitEntity } from '../../src/sim/types';
import { ctxOf, findFree, giveResources, makeGame, place, reload, step, townCenter, type Game } from './wp8helpers';

const FREE = { food: 0, wood: 0, gold: 0, stone: 0 };

function apply(g: Game, ctx: SimContext, input: CommandInput, playerId = 1): SimEvent[] {
  ctx.events = [];
  applyCommands(ctx, [{ ...input, playerId, seq: g.seq++ } as never]);
  return ctx.events;
}

const rejects = (events: SimEvent[]): string[] =>
  events.flatMap((e) => (e.type === 'CommandRejected' ? [e.reason] : []));

function queueFinished(b: { queue: unknown[] }, unitType: string): void {
  b.queue.push({ kind: 'unit', unitType, costPaid: { ...FREE }, ticksDone: 21, ticksTotal: 22, popCapNotified: false });
}

const units = (g: Game): UnitEntity[] => g.state.entities.filter((e): e is UnitEntity => e.kind === 'unit');

describe('last Town Center cannot be deleted (defect 1)', () => {
  it('rejects deleting the only Town Center and leaves everything untouched', () => {
    const g = makeGame();
    const tc = townCenter(g);
    const ctx = ctxOf(g);
    const events = apply(g, ctx, { type: 'delete', entityIds: [tc.id] });
    expect(rejects(events)).toEqual(['cannotPerform']);
    runCleanup(ctx);
    expect(findEntity(g.state, tc.id)).toBeDefined();
  });

  it('allows deleting a Town Center when another completed one stands, but not both at once', () => {
    const g = makeGame();
    const tc1 = townCenter(g);
    const tc2 = place(g, 'townCenter');
    const ctx = ctxOf(g);
    expect(rejects(apply(g, ctx, { type: 'delete', entityIds: [tc1.id, tc2.id] }))).toEqual(['cannotPerform']);
    expect(rejects(apply(g, ctx, { type: 'delete', entityIds: [tc2.id] }))).toEqual([]);
    runCleanup(ctx);
    expect(findEntity(g.state, tc2.id)).toBeUndefined();
    // Now tc1 is the last one again.
    expect(rejects(apply(g, ctx, { type: 'delete', entityIds: [tc1.id] }))).toEqual(['cannotPerform']);
  });

  it('a second delete in the same tick cannot remove the last one either', () => {
    const g = makeGame();
    const tc1 = townCenter(g);
    const tc2 = place(g, 'townCenter');
    const ctx = ctxOf(g);
    ctx.events = [];
    applyCommands(ctx, [
      { type: 'delete', entityIds: [tc1.id], playerId: 1, seq: 1 },
      { type: 'delete', entityIds: [tc2.id], playerId: 1, seq: 2 },
    ]);
    expect(rejects(ctx.events)).toEqual(['cannotPerform']);
  });

  it('an unfinished Town Center foundation can still be deleted', () => {
    const g = makeGame();
    const foundation = place(g, 'townCenter', 1, false);
    const ctx = ctxOf(g);
    expect(rejects(apply(g, ctx, { type: 'delete', entityIds: [foundation.id] }))).toEqual([]);
  });
});

describe('deleting a building with a queue (edge case)', () => {
  it('refunds every queued item in full and removes the building', () => {
    const g = makeGame();
    giveResources(g, 1, 5000);
    const barracks = place(g, 'barracks');
    const ctx = ctxOf(g);
    const before = { ...g.state.players[1]!.resources };
    apply(g, ctx, { type: 'train', buildingId: barracks.id, unitType: 'spearman' });
    apply(g, ctx, { type: 'train', buildingId: barracks.id, unitType: 'spearman' });
    expect(g.state.players[1]!.resources.food).toBeLessThan(before.food);
    apply(g, ctx, { type: 'delete', entityIds: [barracks.id] });
    runCleanup(ctx);
    expect(g.state.players[1]!.resources).toEqual(before);
    expect(findEntity(g.state, barracks.id)).toBeUndefined();
  });
});

describe('spawn spreading (defect 2)', () => {
  it('successive spawns without a rally point use distinct tiles', () => {
    const g = makeGame();
    const at = findFree(g, 3);
    const b = place(g, 'barracks', 1, true, at);
    for (let i = 0; i < 3; i++) place(g, 'house');
    const ctx = ctxOf(g);
    giveResources(g);
    const before = units(g).length;
    for (let i = 0; i < 12; i++) {
      queueFinished(b, 'spearman');
      runProduction(ctx);
      // runMovement is not part of runProduction: units stay exactly where they spawned.
    }
    const spawned = units(g).slice(before);
    expect(spawned).toHaveLength(12);
    const tiles = new Set(spawned.map((u) => `${Math.floor(u.pos.x)},${Math.floor(u.pos.y)}`));
    expect(tiles.size).toBe(12);
    // The first fill the south side nearest the front, spreading outward only when the ring is full.
    expect(spawned[0]!.pos.y).toBe(at.ty + 3.5);
  });

  it('is deterministic and spreads through the full sim step too', () => {
    const run = (): string[] => {
      const g = makeGame({ seed: 5 });
      giveResources(g);
      const tc = townCenter(g);
      for (let i = 0; i < 6; i++) queueFinished(tc, 'villager');
      const base = units(g).length;
      for (let i = 0; i < 2; i++) place(g, 'house');
      reload(g);
      for (let i = 0; i < 6; i++) step(g);
      return units(g)
        .slice(base)
        .map((u) => `${u.pos.x.toFixed(3)},${u.pos.y.toFixed(3)}`);
    };
    const a = run();
    expect(a).toEqual(run());
    expect(a.length).toBeGreaterThan(0);
    expect(new Set(a.map((p) => p.split(',').map((v) => Math.floor(Number(v))).join(','))).size).toBe(a.length);
  });
});

describe('rally onto a full or depleted resource (defect 3)', () => {
  function berryScene() {
    const g = makeGame();
    giveResources(g);
    const tc = townCenter(g);
    // Clear the generated resources so only the test's own nodes exist.
    for (const e of g.state.entities) if (e.kind === 'node') e.amount = 0;
    runCleanup(ctxOf(g));
    const berry = createNode(g.state, 'berryBush', tc.tile.tx + 8, tc.tile.ty + 8, 200);
    tc.rally = { x: berry.tile.tx + 0.5, y: berry.tile.ty + 0.5, targetId: berry.id };
    return { g, tc, berry };
  }

  it('sends the unit to the nearest free node of the same resource within 16 tiles', () => {
    const { g, tc, berry } = berryScene();
    const other = createNode(g.state, 'berryBush', berry.tile.tx + 6, berry.tile.ty, 200);
    const farTree = createNode(g.state, 'tree', berry.tile.tx + 1, berry.tile.ty + 2, 200);
    berry.gathererIds = [9001, 9002, 9003, 9004, 9005];
    const ctx = ctxOf(g);
    queueFinished(tc, 'villager');
    runProduction(ctx);
    const v = units(g).pop()!;
    expect(v.orderQueue).toEqual([{ type: 'gather', targetId: other.id }]);
    expect(v.orderQueue).not.toContainEqual({ type: 'gather', targetId: farTree.id });
    expect(ctx.events.filter((e) => e.type === 'VillagerIdle')).toHaveLength(0);
  });

  it('with nothing free it walks to the rally point and reports idle exactly once', () => {
    const { g, tc, berry } = berryScene();
    berry.gathererIds = [9001, 9002, 9003, 9004, 9005];
    const ctx = ctxOf(g);
    queueFinished(tc, 'villager');
    runProduction(ctx);
    const v = units(g).pop()!;
    expect(v.orderQueue).toEqual([{ type: 'move', x: berry.tile.tx + 0.5, y: berry.tile.ty + 0.5 }]);
    expect(ctx.events.filter((e) => e.type === 'VillagerIdle')).toHaveLength(1);
    // Run it to the end: the finished move produces no further idle event.
    reload(g);
    let idleEvents = 0;
    for (let i = 0; i < 20 * 25; i++) idleEvents += step(g).filter((e) => e.type === 'VillagerIdle').length;
    expect(idleEvents).toBe(0);
  });

  it('a node beyond 16 tiles is not used', () => {
    const { g, tc, berry } = berryScene();
    createNode(g.state, 'berryBush', berry.tile.tx + 20, berry.tile.ty, 200);
    berry.gathererIds = [9001, 9002, 9003, 9004, 9005];
    const ctx = ctxOf(g);
    queueFinished(tc, 'villager');
    runProduction(ctx);
    expect(units(g).pop()!.orderQueue[0]!.type).toBe('move');
  });

  it('when the rally node is depleted the rally follows the nearest node of the same resource', () => {
    const { g, tc, berry } = berryScene();
    const other = createNode(g.state, 'berryBush', berry.tile.tx + 5, berry.tile.ty + 1, 200);
    const ctx = ctxOf(g);
    berry.amount = 0;
    runCleanup(ctx);
    expect(tc.rally).toEqual({ x: other.tile.tx + 0.5, y: other.tile.ty + 0.5, targetId: other.id });
  });

  it('when the rally node is depleted and nothing is near, the rally becomes a ground rally at the old spot', () => {
    const { g, tc, berry } = berryScene();
    const ctx = ctxOf(g);
    const where = { x: tc.rally!.x, y: tc.rally!.y };
    berry.amount = 0;
    runCleanup(ctx);
    expect(tc.rally).toEqual({ ...where, targetId: null });
    queueFinished(tc, 'villager');
    runProduction(ctx);
    expect(units(g).pop()!.orderQueue).toEqual([{ type: 'move', ...where }]);
  });
});

describe('population counts living units only (defect 4)', () => {
  it('queued units do not raise popUsed', () => {
    const g = makeGame();
    giveResources(g);
    const tc = townCenter(g);
    const ctx = ctxOf(g);
    const used = g.state.players[1]!.popUsed;
    for (let i = 0; i < 10; i++) apply(g, ctx, { type: 'train', buildingId: tc.id, unitType: 'villager' });
    expect(tc.queue).toHaveLength(10);
    expect(g.state.players[1]!.popUsed).toBe(used);
    expect(g.state.players[1]!.popUsed).toBeLessThanOrEqual(g.state.players[1]!.popCap);
  });

  it('two buildings finishing in the same tick cannot both exceed the cap: the lower id wins', () => {
    const g = makeGame();
    giveResources(g);
    const a = place(g, 'barracks');
    const b = place(g, 'barracks');
    expect(a.id).toBeLessThan(b.id);
    const ctx = ctxOf(g);
    const p = g.state.players[1]!;
    while (units(g).length < p.popCap - 1) createUnit(g.state, 'villager', 1, 5, 5);
    ctx.events = [];
    queueFinished(b, 'spearman');
    queueFinished(a, 'spearman');
    runProduction(ctx);
    expect(a.queue).toHaveLength(0);
    expect(b.queue).toHaveLength(1);
    expect(units(g)).toHaveLength(p.popCap);
    expect(ctx.events.filter((e) => e.type === 'PopulationCapped')).toMatchObject([{ buildingId: b.id }]);
    expect(p.popUsed).toBeLessThanOrEqual(p.popCap);
  });
});

describe('selection / construction edge cases', () => {
  it('cancelling construction while builders are en route frees them and refunds in full', () => {
    const g = makeGame();
    giveResources(g, 1, 1000);
    const ctx = ctxOf(g);
    const vill = units(g).filter((u) => u.owner === 1).slice(0, 2);
    const at = findFree(g, 2);
    const before = { ...g.state.players[1]!.resources };
    apply(g, ctx, { type: 'build', unitIds: vill.map((v) => v.id), buildingType: 'house', tx: at.tx, ty: at.ty, queue: false });
    const foundation = g.state.entities.find((e) => e.kind === 'building' && !e.constructed)!;
    expect(foundation).toBeDefined();
    expect(g.state.players[1]!.resources.wood).toBeLessThan(before.wood);
    apply(g, ctx, { type: 'cancelConstruction', buildingId: foundation.id });
    runCleanup(ctx);
    expect(findEntity(g.state, foundation.id)).toBeUndefined();
    expect(g.state.players[1]!.resources).toEqual(before);
    // The builders carry on without crashing and end up idle.
    for (let i = 0; i < 100; i++) step(g);
    for (const v of vill) expect(findEntity(g.state, v.id)).toBeDefined();
    for (const v of vill) {
      const live = findEntity(g.state, v.id) as UnitEntity;
      expect(live.currentOrder === null || live.currentOrder.type !== 'build').toBe(true);
    }
  });
});
