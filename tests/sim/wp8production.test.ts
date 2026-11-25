import { describe, expect, it } from 'vitest';
import { createNode, createUnit } from '../../src/sim/entities';
import { applyCommands } from '../../src/sim/systems/commands';
import { runIncome } from '../../src/sim/systems/income';
import { runObjectives } from '../../src/sim/systems/objectives';
import { runProduction } from '../../src/sim/systems/production';
import { recomputePopulation } from '../../src/sim/systems/population';
import { MAX_PRODUCTION_QUEUE, TICK_RATE, type CommandInput, type SimContext, type SimEvent } from '../../src/sim/types';
import { ctxOf, findFree, giveResources, makeGame, place, reload, step, townCenter, type Game } from './wp8helpers';

/** Apply one command directly (tick-step 1) and return the events it emitted. */
function apply(g: Game, ctx: SimContext, input: CommandInput, playerId = 1): SimEvent[] {
  ctx.events = [];
  applyCommands(ctx, [{ ...input, playerId, seq: g.seq++ } as never]);
  return ctx.events;
}

function reasons(events: SimEvent[]): string[] {
  return events.filter((e) => e.type === 'CommandRejected').map((e) => (e.type === 'CommandRejected' ? e.reason : ''));
}

describe('train and research validation', () => {
  it('rejects with the right reason codes', () => {
    const g = makeGame({ players: 2 });
    const barracks = place(g, 'barracks');
    const foundation = place(g, 'barracks', 1, false);
    const enemyTc = townCenter(g, 2);
    const tc = townCenter(g);
    const ctx = ctxOf(g);
    const train = (buildingId: number, unitType: string, p = 1) => reasons(apply(g, ctx, { type: 'train', buildingId, unitType }, p));
    expect(train(99999, 'villager')).toEqual(['unknownEntity']);
    expect(train(enemyTc.id, 'villager')).toEqual(['notOwner']);
    expect(train(foundation.id, 'spearman')).toEqual(['notConstructed']);
    expect(train(tc.id, 'nonsense')).toEqual(['unknownDef']);
    expect(train(tc.id, 'houseish')).toEqual(['unknownDef']);
    expect(train(tc.id, 'spearman')).toEqual(['cannotPerform']);
    expect(train(tc.id, 'ironAxes')).toEqual(['unknownDef']); // a tech is not a unit
    expect(train(barracks.id, 'swordsman')).toEqual(['notAvailable']);
    const ev = apply(g, ctx, { type: 'train', buildingId: barracks.id, unitType: 'swordsman' });
    expect(ev[0]).toMatchObject({ unavailable: [{ code: 'requiresAge', age: 2 }] });
    g.state.players[1]!.resources.food = 10;
    const poor = apply(g, ctx, { type: 'train', buildingId: tc.id, unitType: 'villager' });
    expect(poor[0]).toMatchObject({ reason: 'cannotAfford', shortfall: { food: 40, wood: 0, gold: 0, stone: 0 } });
    expect(tc.queue).toHaveLength(0);
    expect(g.state.players[1]!.resources.food).toBe(10);

    const research = (buildingId: number, techId: string) => reasons(apply(g, ctx, { type: 'research', buildingId, techId }));
    expect(research(tc.id, 'villager')).toEqual(['unknownDef']);
    expect(research(tc.id, 'ironAxes')).toEqual(['cannotPerform']); // researched at the Lumber Camp
    expect(research(foundation.id, 'ironAxes')).toEqual(['notConstructed']);
    expect(research(tc.id, 'handCarts')).toEqual(['notAvailable']);
    expect(research(tc.id, 'townshipAge')).toEqual(['notAvailable']); // no age buildings
  });

  it('rejects a Lancer for Byzantines and trains the Cataphract', () => {
    const g = makeGame();
    const stable = place(g, 'stable');
    g.state.players[1]!.age = 3;
    giveResources(g);
    const ctx = ctxOf(g);
    expect(reasons(apply(g, ctx, { type: 'train', buildingId: stable.id, unitType: 'lancer' }))).toEqual(['notAvailable']);
    expect(reasons(apply(g, ctx, { type: 'train', buildingId: stable.id, unitType: 'cataphract' }))).toEqual([]);
    expect(stable.queue).toHaveLength(1);
  });

  it('queue holds at most 10 items shared between units and techs', () => {
    const g = makeGame();
    giveResources(g);
    const tc = townCenter(g);
    g.state.players[1]!.age = 2;
    const ctx = ctxOf(g);
    for (let i = 0; i < MAX_PRODUCTION_QUEUE - 1; i++) {
      expect(reasons(apply(g, ctx, { type: 'train', buildingId: tc.id, unitType: 'villager' }))).toEqual([]);
    }
    expect(reasons(apply(g, ctx, { type: 'research', buildingId: tc.id, techId: 'handCarts' }))).toEqual([]);
    expect(tc.queue).toHaveLength(10);
    const before = { ...g.state.players[1]!.resources };
    expect(reasons(apply(g, ctx, { type: 'train', buildingId: tc.id, unitType: 'villager' }))).toEqual(['queueFull']);
    expect(reasons(apply(g, ctx, { type: 'research', buildingId: tc.id, techId: 'guildCharters' }))).toEqual(['queueFull']);
    expect(g.state.players[1]!.resources).toEqual(before);
  });

  it('a tech cannot be queued twice and disappears once researched', () => {
    const g = makeGame();
    giveResources(g);
    g.state.players[1]!.age = 2;
    const tc = townCenter(g);
    const ctx = ctxOf(g);
    expect(reasons(apply(g, ctx, { type: 'research', buildingId: tc.id, techId: 'handCarts' }))).toEqual([]);
    const ev = apply(g, ctx, { type: 'research', buildingId: tc.id, techId: 'handCarts' });
    expect(ev[0]).toMatchObject({ reason: 'notAvailable', unavailable: [{ code: 'researchInProgress' }] });
  });
});

describe('cost, refund and queue progress', () => {
  it('deducts resolved cost on enqueue and refunds exactly on cancel, at any index', () => {
    const g = makeGame();
    g.state.players[1]!.age = 2;
    giveResources(g, 1, 1000);
    const tc = townCenter(g);
    const ctx = ctxOf(g);
    const res = () => ({ ...g.state.players[1]!.resources });
    apply(g, ctx, { type: 'train', buildingId: tc.id, unitType: 'villager' });
    apply(g, ctx, { type: 'research', buildingId: tc.id, techId: 'handCarts' });
    apply(g, ctx, { type: 'train', buildingId: tc.id, unitType: 'villager' });
    expect(res()).toEqual({ food: 1000 - 50 - 150 - 50, wood: 1000 - 100, gold: 1000, stone: 1000 });
    expect(tc.queue.map((i) => i.costPaid)).toEqual([
      { food: 50, wood: 0, gold: 0, stone: 0 },
      { food: 150, wood: 100, gold: 0, stone: 0 },
      { food: 50, wood: 0, gold: 0, stone: 0 },
    ]);
    // progress on the head, then cancel it: still a full refund
    for (let i = 0; i < 100; i++) runProduction(ctx);
    expect(tc.queue[0]!.ticksDone).toBe(100);
    apply(g, ctx, { type: 'cancelQueue', buildingId: tc.id, index: 1 });
    expect(res()).toEqual({ food: 1000 - 50 - 50, wood: 1000, gold: 1000, stone: 1000 });
    expect(tc.queue).toHaveLength(2);
    apply(g, ctx, { type: 'cancelQueue', buildingId: tc.id, index: 0 });
    apply(g, ctx, { type: 'cancelQueue', buildingId: tc.id, index: 0 });
    expect(res()).toEqual({ food: 1000, wood: 1000, gold: 1000, stone: 1000 });
    expect(tc.queue).toHaveLength(0);
  });

  it('refund uses the cost paid, not the cost now (Themata applied after enqueue changes nothing)', () => {
    const g = makeGame();
    giveResources(g, 1, 1000);
    const tc = townCenter(g);
    const ctx = ctxOf(g);
    apply(g, ctx, { type: 'train', buildingId: tc.id, unitType: 'villager' });
    tc.queue[0]!.costPaid.food = 37; // pretend a different price was paid
    apply(g, ctx, { type: 'cancelQueue', buildingId: tc.id, index: 0 });
    expect(g.state.players[1]!.resources.food).toBe(1000 - 50 + 37);
  });

  it('cancelQueue validates', () => {
    const g = makeGame({ players: 2 });
    const tc = townCenter(g);
    const ctx = ctxOf(g);
    expect(reasons(apply(g, ctx, { type: 'cancelQueue', buildingId: tc.id, index: 0 }))).toEqual(['invalidIndex']);
    expect(reasons(apply(g, ctx, { type: 'cancelQueue', buildingId: tc.id, index: -1 }))).toEqual(['invalidIndex']);
    expect(reasons(apply(g, ctx, { type: 'cancelQueue', buildingId: townCenter(g, 2).id, index: 0 }))).toEqual(['notOwner']);
    expect(reasons(apply(g, ctx, { type: 'cancelQueue', buildingId: 99999, index: 0 }))).toEqual(['unknownEntity']);
  });

  it('fixes ticksTotal at enqueue and finishes after exactly that many production ticks', () => {
    const g = makeGame();
    const tc = townCenter(g);
    const ctx = ctxOf(g);
    apply(g, ctx, { type: 'train', buildingId: tc.id, unitType: 'villager' });
    expect(tc.queue[0]).toMatchObject({ ticksTotal: 20 * TICK_RATE, ticksDone: 0 });
    const unitsBefore = g.state.entities.filter((e) => e.kind === 'unit').length;
    for (let i = 0; i < 399; i++) runProduction(ctx);
    expect(g.state.entities.filter((e) => e.kind === 'unit')).toHaveLength(unitsBefore);
    expect(ctx.events.filter((e) => e.type === 'UnitTrained')).toHaveLength(0);
    runProduction(ctx);
    expect(g.state.entities.filter((e) => e.kind === 'unit')).toHaveLength(unitsBefore + 1);
    expect(ctx.events.filter((e) => e.type === 'UnitTrained')).toHaveLength(1);
    expect(tc.queue).toHaveLength(0);
  });

  it('only the head item progresses and the next one starts after it', () => {
    const g = makeGame();
    giveResources(g);
    const tc = townCenter(g);
    const ctx = ctxOf(g);
    apply(g, ctx, { type: 'train', buildingId: tc.id, unitType: 'villager' });
    apply(g, ctx, { type: 'train', buildingId: tc.id, unitType: 'villager' });
    for (let i = 0; i < 10; i++) runProduction(ctx);
    expect(tc.queue.map((q) => q.ticksDone)).toEqual([10, 0]);
    for (let i = 0; i < 390; i++) runProduction(ctx);
    expect(tc.queue).toHaveLength(1);
    expect(tc.queue[0]!.ticksDone).toBe(0);
    runProduction(ctx);
    expect(tc.queue[0]!.ticksDone).toBe(1);
  });

  it('unfinished buildings do not produce; the instantResearch cheat finishes on the first tick', () => {
    const g = makeGame();
    giveResources(g);
    const b = place(g, 'barracks', 1, false);
    b.queue.push({ kind: 'unit', unitType: 'spearman', costPaid: { food: 0, wood: 0, gold: 0, stone: 0 }, ticksDone: 0, ticksTotal: 5, popCapNotified: false });
    const ctx = ctxOf(g);
    for (let i = 0; i < 10; i++) runProduction(ctx);
    expect(b.queue[0]!.ticksDone).toBe(0);
    b.constructed = true;
    b.progress = 1;
    g.state.players[1]!.cheats.instantResearch = true;
    const ctx2 = ctxOf(g);
    runProduction(ctx2);
    expect(b.queue).toHaveLength(0);
    expect(ctx2.events.map((e) => e.type)).toEqual(['UnitTrained']);
  });
});

describe('population', () => {
  it('cap is the sum of completed buildings, hard-capped at 200; used counts living units and queued units', () => {
    const g = makeGame();
    const ctx = ctxOf(g);
    const p = g.state.players[1]!;
    const living = g.state.entities.filter((e) => e.kind === 'unit' && e.owner === 1).length;
    expect(p.popCap).toBe(10);
    expect(p.popUsed).toBe(living);
    place(g, 'house', 1, false);
    recomputePopulation(ctx);
    expect(p.popCap).toBe(10); // unfinished buildings provide nothing
    place(g, 'house');
    recomputePopulation(ctx);
    expect(p.popCap).toBe(20);
    for (let i = 0; i < 25; i++) place(g, 'house');
    recomputePopulation(ctx);
    expect(p.popCap).toBe(200);
    // queued units count, queued techs do not; siege weighs 3
    const ctx2 = ctxOf(g);
    giveResources(g);
    p.age = 3;
    const sw = place(g, 'siegeWorkshop');
    const ctx3 = ctxOf(g);
    apply(g, ctx3, { type: 'train', buildingId: sw.id, unitType: 'batteringRam' });
    apply(g, ctx3, { type: 'train', buildingId: townCenter(g).id, unitType: 'villager' });
    expect(p.popUsed).toBe(living + 3 + 1);
    expect(ctx2.state).toBe(ctx3.state);
  });

  it('a unit finishing at the cap holds at 100%, announces once, and spawns when room appears', () => {
    const g = makeGame();
    giveResources(g);
    const tc = townCenter(g);
    // fill the cap of 10 with living units
    const living = () => g.state.entities.filter((e) => e.kind === 'unit' && e.owner === 1).length;
    while (living() < 10) createUnit(g.state, 'villager', 1, 5, 5);
    const ctx = ctxOf(g);
    expect(g.state.players[1]!.popUsed).toBe(10);
    apply(g, ctx, { type: 'train', buildingId: tc.id, unitType: 'villager' });
    apply(g, ctx, { type: 'train', buildingId: tc.id, unitType: 'villager' });
    const capped: SimEvent[] = [];
    for (let i = 0; i < 1000; i++) {
      ctx.events = [];
      runProduction(ctx);
      capped.push(...ctx.events.filter((e) => e.type === 'PopulationCapped'));
    }
    expect(capped).toHaveLength(1);
    expect(capped[0]).toMatchObject({ type: 'PopulationCapped', buildingId: tc.id, unitType: 'villager' });
    expect(tc.queue).toHaveLength(2);
    expect(tc.queue[0]).toMatchObject({ ticksDone: 400, ticksTotal: 400, popCapNotified: true });
    expect(tc.queue[1]!.ticksDone).toBe(0); // the held item blocks the queue
    expect(living()).toBe(10);
    // room: one more house
    place(g, 'house');
    ctx.events = [];
    runProduction(ctx);
    expect(ctx.events.map((e) => e.type)).toEqual(['UnitTrained']);
    expect(living()).toBe(11);
    expect(tc.queue).toHaveLength(1);
  });

  it('room is judged against living units only, so an item is not blocked by items queued behind it', () => {
    const g = makeGame();
    giveResources(g);
    const tc = townCenter(g);
    const living = () => g.state.entities.filter((e) => e.kind === 'unit' && e.owner === 1).length;
    while (living() < 9) createUnit(g.state, 'villager', 1, 5, 5);
    const ctx = ctxOf(g);
    apply(g, ctx, { type: 'train', buildingId: tc.id, unitType: 'villager' });
    apply(g, ctx, { type: 'train', buildingId: tc.id, unitType: 'villager' });
    for (let i = 0; i < 400; i++) runProduction(ctx);
    expect(living()).toBe(10);
    expect(tc.queue).toHaveLength(1);
  });
});

describe('spawn tile and rally', () => {
  it('spawns on the tile adjacent to the building nearest the rally point', () => {
    const g = makeGame();
    giveResources(g);
    const at = findFree(g, 3);
    const b = place(g, 'barracks', 1, true, at);
    b.rally = { x: at.tx + 3 + 10.5, y: at.ty + 1.5, targetId: null };
    const ctx = ctxOf(g);
    apply(g, ctx, { type: 'train', buildingId: b.id, unitType: 'spearman' });
    for (let i = 0; i < 22 * TICK_RATE; i++) runProduction(ctx);
    const unit = g.state.entities.filter((e) => e.kind === 'unit').pop()!;
    expect(unit).toMatchObject({ kind: 'unit', typeId: 'spearman', pos: { x: at.tx + 3.5, y: at.ty + 1.5 } });
    const trained = ctx.events.find((e) => e.type === 'UnitTrained');
    expect(trained).toMatchObject({ unitId: unit.id, buildingId: b.id, unitType: 'spearman', playerId: 1 });
  });

  it('skips blocked adjacent tiles and breaks ties by tile index', () => {
    const g = makeGame();
    const at = findFree(g, 3);
    const b = place(g, 'barracks', 1, true, at);
    // block the best tile (east, middle) with a 1x1 stand-in: a node
    createNode(g.state, 'tree', at.tx + 3, at.ty + 1, 100);
    b.rally = { x: at.tx + 13.5, y: at.ty + 1.5, targetId: null };
    const ctx = ctxOf(g);
    b.queue.push({ kind: 'unit', unitType: 'spearman', costPaid: { food: 0, wood: 0, gold: 0, stone: 0 }, ticksDone: 21, ticksTotal: 22, popCapNotified: false });
    runProduction(ctx);
    const unit = g.state.entities.filter((e) => e.kind === 'unit').pop()!;
    if (unit.kind !== 'unit') throw new Error();
    // east column tiles (tx+3, ty..ty+2) are nearest; the middle is blocked, so ty+0 and ty+2 tie at the same
    // distance and the lower tile index (ty+0) wins... unless the diagonal ring tiles beat them.
    const candidates = [
      { x: at.tx + 3.5, y: at.ty + 0.5 },
      { x: at.tx + 3.5, y: at.ty + 2.5 },
    ];
    expect(candidates).toContainEqual(unit.pos);
    expect(unit.pos).toEqual({ x: at.tx + 3.5, y: at.ty + 0.5 });
  });

  it('without a rally point units appear next to the building on the south side', () => {
    const g = makeGame();
    const at = findFree(g, 3);
    const b = place(g, 'barracks', 1, true, at);
    const ctx = ctxOf(g);
    b.queue.push({ kind: 'unit', unitType: 'spearman', costPaid: { food: 0, wood: 0, gold: 0, stone: 0 }, ticksDone: 21, ticksTotal: 22, popCapNotified: false });
    runProduction(ctx);
    const unit = g.state.entities.filter((e) => e.kind === 'unit').pop()!;
    if (unit.kind !== 'unit') throw new Error();
    expect(unit.pos.y).toBe(at.ty + 3.5);
    expect(unit.orderQueue).toEqual([]);
    expect(unit.currentOrder).toBeNull();
  });

  const finishOne = (g: Game, unitType: string, rally: { x: number; y: number; targetId: number | null }) => {
    const at = findFree(g, 3);
    const b = place(g, 'barracks', 1, true, at);
    b.rally = rally;
    const ctx = ctxOf(g);
    b.queue.push({ kind: 'unit', unitType, costPaid: { food: 0, wood: 0, gold: 0, stone: 0 }, ticksDone: 21, ticksTotal: 22, popCapNotified: false });
    runProduction(ctx);
    const unit = g.state.entities.filter((e) => e.kind === 'unit').pop()!;
    if (unit.kind !== 'unit') throw new Error();
    return unit;
  };

  it('ground rally gives a move order', () => {
    const g = makeGame();
    const unit = finishOne(g, 'spearman', { x: 90.25, y: 80.5, targetId: null });
    expect(unit.orderQueue).toEqual([{ type: 'move', x: 90.25, y: 80.5 }]);
  });

  it('rally on a node or farm gives villagers a gather order; others get a move', () => {
    const g = makeGame();
    const node = createNode(g.state, 'tree', 100, 100, 100);
    for (let i = 0; i < 3; i++) place(g, 'house'); // room under the cap
    const farm = place(g, 'farm', 1, true);
    const gold = createNode(g.state, 'goldDeposit', 102, 100, 800);
    // villagers can train at the Town Center; make a dummy producer by calling through a Town Center
    const tc = townCenter(g);
    const ctx = ctxOf(g);
    const trainVillager = (rally: { x: number; y: number; targetId: number | null }) => {
      tc.rally = rally;
      tc.queue.push({ kind: 'unit', unitType: 'villager', costPaid: { food: 0, wood: 0, gold: 0, stone: 0 }, ticksDone: 399, ticksTotal: 400, popCapNotified: false });
      runProduction(ctx);
      const u = g.state.entities.filter((e) => e.kind === 'unit').pop()!;
      if (u.kind !== 'unit') throw new Error();
      return u;
    };
    expect(trainVillager({ x: 100.5, y: 100.5, targetId: node.id }).orderQueue).toEqual([{ type: 'gather', targetId: node.id }]);
    expect(trainVillager({ x: 1, y: 1, targetId: farm.id }).orderQueue).toEqual([{ type: 'gather', targetId: farm.id }]);
    expect(trainVillager({ x: 103, y: 101, targetId: gold.id }).orderQueue).toEqual([{ type: 'gather', targetId: gold.id }]);
    // a rally target that no longer exists falls back to the stored point
    expect(trainVillager({ x: 50.5, y: 60.5, targetId: 424242 }).orderQueue).toEqual([{ type: 'move', x: 50.5, y: 60.5 }]);
    // a soldier never gathers
    const sp = finishOne(g, 'spearman', { x: 100.5, y: 100.5, targetId: node.id });
    expect(sp.orderQueue).toEqual([{ type: 'move', x: 100.5, y: 100.5 }]);
  });
});

describe('setRally', () => {
  it('sets, replaces and validates', () => {
    const g = makeGame({ players: 2 });
    const tc = townCenter(g);
    const house = place(g, 'house');
    const node = createNode(g.state, 'tree', 100, 100, 100);
    const ctx = ctxOf(g);
    expect(reasons(apply(g, ctx, { type: 'setRally', buildingIds: [tc.id], x: 40, y: 41 }))).toEqual([]);
    expect(tc.rally).toEqual({ x: 40, y: 41, targetId: null });
    expect(reasons(apply(g, ctx, { type: 'setRally', buildingIds: [tc.id], x: 100.5, y: 100.5, targetId: node.id }))).toEqual([]);
    expect(tc.rally).toEqual({ x: 100.5, y: 100.5, targetId: node.id });
    expect(reasons(apply(g, ctx, { type: 'setRally', buildingIds: [tc.id, house.id], x: 1, y: 1 }))).toEqual(['cannotPerform']);
    expect(tc.rally?.x).toBe(100.5); // all or nothing
    expect(reasons(apply(g, ctx, { type: 'setRally', buildingIds: [townCenter(g, 2).id], x: 1, y: 1 }))).toEqual(['notOwner']);
    expect(reasons(apply(g, ctx, { type: 'setRally', buildingIds: [424242], x: 1, y: 1 }))).toEqual(['unknownEntity']);
    expect(reasons(apply(g, ctx, { type: 'setRally', buildingIds: [tc.id], x: 1, y: 1, targetId: 424242 }))).toEqual(['invalidTarget']);
    expect(reasons(apply(g, ctx, { type: 'setRally', buildingIds: [tc.id], x: 500, y: 1 }))).toEqual(['invalidTarget']);
  });
});

describe('passive income', () => {
  it('Silk Workshop pays exactly 0.25 gold/s: 125 gold in 10,000 ticks', () => {
    const g = makeGame();
    const sw = place(g, 'silkWorkshop');
    const ctx = ctxOf(g);
    const gold0 = g.state.players[1]!.resources.gold;
    for (let t = 1; t <= 10_000; t++) {
      runIncome(ctx);
      // one gold every 80 ticks, exactly on schedule
      expect(g.state.players[1]!.resources.gold - gold0).toBe(Math.floor(t / 80));
      expect(sw.incomeAccumulator).toBeGreaterThanOrEqual(0);
      expect(sw.incomeAccumulator).toBeLessThan(1);
    }
    expect(g.state.players[1]!.resources.gold - gold0).toBe(125);
    expect(Number.isInteger(g.state.players[1]!.resources.gold)).toBe(true);
    expect(sw.incomeAccumulator).toBe(0);
  });

  it('two workshops pay double; foundations and non-income buildings pay nothing', () => {
    const g = makeGame();
    place(g, 'silkWorkshop');
    place(g, 'silkWorkshop');
    place(g, 'silkWorkshop', 1, false);
    place(g, 'house');
    const ctx = ctxOf(g);
    const gold0 = g.state.players[1]!.resources.gold;
    for (let t = 0; t < 8000; t++) runIncome(ctx);
    expect(g.state.players[1]!.resources.gold - gold0).toBe(200);
  });

  it('runs inside the real tick and the accumulator survives save/load state', () => {
    const g = makeGame();
    place(g, 'silkWorkshop');
    reload(g);
    const gold0 = g.state.players[1]!.resources.gold;
    for (let t = 0; t < 400; t++) g.sim.step([]);
    expect(g.state.players[1]!.resources.gold - gold0).toBe(5);
  });
});

describe('research, ages and the objective', () => {
  function reachEmpire(g: Game): SimEvent[] {
    const events: SimEvent[] = [];
    giveResources(g);
    g.state.players[1]!.cheats.instantResearch = true;
    const tc = townCenter(g);
    const stages: [string[], string][] = [
      [['mill', 'barracks'], 'townshipAge'],
      [['archeryRange', 'stable'], 'citadelAge'],
      [['siegeWorkshop', 'silkWorkshop'], 'empireAge'],
    ];
    for (const [buildings, tech] of stages) {
      for (const b of buildings) place(g, b);
      reload(g);
      events.push(...step(g, [1, { type: 'research', buildingId: tc.id, techId: tech }]));
      events.push(...g.sim.step([]));
    }
    return events;
  }

  it('advances ages in order, emits events, and fires the objective exactly once', () => {
    const g = makeGame();
    const events = reachEmpire(g);
    const types = events.map((e) => (e.type === 'AgeAdvanced' ? `age${e.age}` : e.type));
    expect(types.filter((t) => t.startsWith('age'))).toEqual(['age2', 'age3', 'age4']);
    expect(events.filter((e) => e.type === 'ResearchCompleted').map((e) => (e.type === 'ResearchCompleted' ? e.techId : ''))).toEqual([
      'townshipAge', 'citadelAge', 'empireAge',
    ]);
    expect(g.state.players[1]!.age).toBe(4);
    expect(g.state.players[1]!.researched).toEqual(['townshipAge', 'citadelAge', 'empireAge']);
    const done = events.filter((e) => e.type === 'ObjectiveCompleted');
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ playerId: 1, objectiveId: 'reachEmpireAge:1', tick: g.state.objectives.entries[0]!.completedTick });
    expect(g.state.objectives.entries[0]!.completedTick).not.toBeNull();
    // the game continues and the event is never repeated
    for (let i = 0; i < 50; i++) expect(g.sim.step([]).filter((e) => e.type === 'ObjectiveCompleted')).toHaveLength(0);
  });

  it('age advance cost is deducted, rejected without the buildings, and the age tech is single-flight', () => {
    const g = makeGame();
    const tc = townCenter(g);
    g.state.players[1]!.resources.food = 500;
    let ev = step(g, [1, { type: 'research', buildingId: tc.id, techId: 'townshipAge' }]);
    expect(ev[0]).toMatchObject({ reason: 'notAvailable', unavailable: [{ code: 'ageBuildings', have: 0, need: 2 }] });
    place(g, 'mill');
    place(g, 'farm');
    reload(g);
    ev = step(g, [1, { type: 'research', buildingId: tc.id, techId: 'townshipAge' }]);
    expect(ev).toEqual([]);
    expect(g.state.players[1]!.resources.food).toBe(100);
    expect(tc.queue[0]).toMatchObject({ kind: 'tech', techId: 'townshipAge', ticksTotal: 60 * TICK_RATE });
    expect(g.state.players[1]!.age).toBe(1);
    ev = step(g, [1, { type: 'research', buildingId: tc.id, techId: 'townshipAge' }]);
    expect(ev[0]).toMatchObject({ reason: 'notAvailable' });
    // finishing takes exactly ticksTotal production ticks (two already ran: the enqueue step and the rejected duplicate's step)
    for (let i = 0; i < 60 * TICK_RATE - 3; i++) g.sim.step([]);
    expect(g.state.players[1]!.age).toBe(1);
    const last = g.sim.step([]);
    expect(last.map((e) => e.type)).toEqual(['ResearchCompleted', 'AgeAdvanced']);
    expect(g.state.players[1]!.age).toBe(2);
  });

  it('research completion applies modifiers immediately (Iron Axes via the Lumber Camp)', () => {
    const g = makeGame();
    giveResources(g);
    g.state.players[1]!.age = 2;
    g.state.players[1]!.cheats.instantResearch = true;
    const lc = place(g, 'lumberCamp');
    reload(g);
    expect(g.sim.query.resolvedStat(1, 'villager', 'gatherRate.wood')).toBe(0.4);
    step(g, [1, { type: 'research', buildingId: lc.id, techId: 'ironAxes' }]);
    expect(g.sim.query.resolvedStat(1, 'villager', 'gatherRate.wood')).toBeCloseTo(0.46, 12);
    expect(g.sim.query.availability(1, 'ironAxes')).toMatchObject({ available: false, reasons: [{ code: 'alreadyResearched' }] });
  });

  it('objective check is idempotent and ignores players below the target age', () => {
    const g = makeGame();
    const ctx = ctxOf(g);
    runObjectives(ctx);
    expect(ctx.events).toEqual([]);
    g.state.players[1]!.age = 4;
    runObjectives(ctx);
    runObjectives(ctx);
    expect(ctx.events).toHaveLength(1);
  });

  it('Themata verified numerically: farm cost 20% less and farm work rate 10% faster', () => {
    const g = makeGame();
    const q = g.sim.query;
    expect(q.availability(1, 'farm').cost.wood).toBe(40);
    expect(q.availability(0, 'farm').cost.wood).toBe(50);
    expect(q.resolvedStat(1, 'villager', 'gatherRate.farm') / q.resolvedStat(0, 'villager', 'gatherRate.farm')).toBeCloseTo(1.1, 12);
    expect(q.resolvedStat(1, 'villager', 'gatherRate.wood')).toBe(q.resolvedStat(0, 'villager', 'gatherRate.wood'));
    expect(q.resolvedStat(1, 'house', 'cost.wood')).toBe(50);
  });
});
