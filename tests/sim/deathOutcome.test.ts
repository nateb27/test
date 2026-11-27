/**
 * WP23 (Milestone 2): death (PLAN-M2 4.9) and outcome (4.13): events and kill credit, stats, queue discard, popCap,
 * gather/build recovery, the defeat truth table, resign, draw, sandbox, determinism and save/load around deaths.
 */

import { describe, expect, it } from 'vitest';
import { createGame, deserialize, hashState, serialize, type GameConfig, type GameState, type SimEvent } from '../../src/sim';
import { createUnit, removeEntities } from '../../src/sim/entities';
import type { BuildingEntity, Entity, ResourceNodeEntity, UnitEntity } from '../../src/sim/types';
import { ctxOf, giveResources, makeGame, place, reload, step, townCenter, type Game } from './wp8helpers';

const units = (g: Game, owner: number): UnitEntity[] =>
  g.state.entities.filter((e): e is UnitEntity => e.kind === 'unit' && e.owner === owner);
const ofType = (events: SimEvent[], type: SimEvent['type']): SimEvent[] => events.filter((e) => e.type === type);
const byId = (g: Game, id: number): Entity | undefined => g.state.entities.find((e) => e.id === id);

/** Strip every entity of `owner` (keeps nodes) and rebuild the runtime. */
function clearPlayer(g: Game, owner: number): void {
  removeEntities(g.state, g.state.entities.filter((e) => e.owner === owner).map((e) => e.id));
  reload(g);
}

describe('death events, kill credit and stats (4.9)', () => {
  it('a unit at 0 hp emits UnitDied with the attacker as killer and is removed the same tick', () => {
    const g = makeGame({ players: 2 });
    const victim = units(g, 2)[0]!;
    const attacker = units(g, 1)[0]!;
    victim.hp = 0;
    victim.lastAttackerId = attacker.id;
    victim.carried = { type: 'wood', amount: 5 };
    const events = step(g);
    const died = ofType(events, 'UnitDied');
    expect(died).toEqual([
      { type: 'UnitDied', playerId: 2, unitId: victim.id, unitType: victim.typeId, x: victim.pos.x, y: victim.pos.y, facing: victim.facing, killerPlayerId: 1 },
    ]);
    expect(byId(g, victim.id)).toBeUndefined();
    expect(g.state.players[2]!.stats.unitsLost).toBe(1);
    expect(g.state.players[1]!.stats.unitsKilled).toBe(1);
  });

  it('no attacker means no credit; a dead shooter is credited through its flying projectile', () => {
    const g = makeGame({ players: 2 });
    const [a, b] = units(g, 2) as [UnitEntity, UnitEntity];
    a.hp = 0;
    b.hp = 0;
    b.lastAttackerId = 9999; // shooter long gone
    g.state.projectiles.push({
      id: 1, kind: 'arrow', owner: 1, sourceId: 9999, sourceType: 'archer', targetId: 12345,
      from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, flightTicks: 10, ticksLeft: 5, damage: 3,
    });
    g.state.nextProjectileId = 2;
    const died = ofType(step(g), 'UnitDied') as Extract<SimEvent, { type: 'UnitDied' }>[];
    expect(died.map((e) => [e.unitId, e.killerPlayerId])).toEqual([[a.id, null], [b.id, 1]]);
    expect(g.state.players[1]!.stats.unitsKilled).toBe(1);
    expect(g.state.players[2]!.stats.unitsLost).toBe(2);
  });

  it('a building at 0 hp emits BuildingDestroyed, counts stats and discards its queue without refund', () => {
    const g = makeGame({ players: 2 });
    giveResources(g, 2, 1000);
    const barracks = place(g, 'barracks', 2);
    reload(g);
    step(g, [2, { type: 'train', buildingId: barracks.id, unitType: 'spearman' }]);
    const spent = { ...g.state.players[2]!.resources };
    expect(barracks.queue.length).toBe(1);
    const enemy = units(g, 1)[0]!;
    barracks.hp = 0;
    barracks.lastAttackerId = enemy.id;
    const events = step(g);
    expect(ofType(events, 'BuildingDestroyed')).toEqual([
      { type: 'BuildingDestroyed', playerId: 2, buildingId: barracks.id, buildingType: 'barracks', tx: barracks.tile.tx, ty: barracks.tile.ty, size: 3, constructed: true, killerPlayerId: 1 },
    ]);
    expect(byId(g, barracks.id)).toBeUndefined();
    expect(g.state.players[2]!.resources).toEqual(spent);
    expect(g.state.players[2]!.stats.buildingsLost).toBe(1);
    expect(g.state.players[1]!.stats.buildingsDestroyed).toBe(1);
  });

  it('a destroyed foundation refunds nothing, unlike delete', () => {
    const g = makeGame({ players: 2 });
    giveResources(g, 2, 1000);
    const f1 = place(g, 'barracks', 2, false);
    f1.costPaid = { food: 0, wood: 200, gold: 0, stone: 0 };
    const f2 = place(g, 'barracks', 2, false);
    f2.costPaid = { food: 0, wood: 200, gold: 0, stone: 0 };
    reload(g);
    f1.hp = 0;
    const before = g.state.players[2]!.resources.wood;
    const events = step(g);
    expect(ofType(events, 'BuildingDestroyed')).toMatchObject([{ constructed: false, killerPlayerId: null }]);
    expect(g.state.players[2]!.resources.wood).toBe(before);
    step(g, [2, { type: 'delete', entityIds: [f2.id] }]);
    expect(g.state.players[2]!.resources.wood).toBe(before + 200);
    expect(g.state.players[2]!.stats.buildingsLost).toBe(1); // the deletion is not a loss
  });

  it('a deleted entity is not counted as a death even at 0 hp', () => {
    const g = makeGame({ players: 2 });
    const u = units(g, 2)[0]!;
    u.hp = 0;
    const events = step(g, [2, { type: 'delete', entityIds: [u.id] }]);
    expect(ofType(events, 'UnitDied')).toEqual([]);
    expect(g.state.players[2]!.stats.unitsLost).toBe(0);
  });

  it('a destroyed House lowers popCap and production holds until there is room', () => {
    const g = makeGame({ players: 2 });
    giveResources(g, 1, 5000);
    const house = place(g, 'house', 1);
    reload(g);
    step(g);
    const p = g.state.players[1]!;
    const capWith = p.popCap;
    const tc = townCenter(g, 1);
    // Fill population to exactly the cap without the house.
    const provided = g.data.building('house').popProvided;
    expect(provided).toBeGreaterThan(0);
    const fillTo = capWith - provided;
    for (let i = p.popUsed; i < fillTo; i++) createUnit(g.state, 'villager', 1, tc.tile.tx - 3, tc.tile.ty + (i % 5), 1);
    reload(g);
    step(g, [1, { type: 'train', buildingId: tc.id, unitType: 'villager' }]);
    house.hp = 0;
    step(g);
    expect(p.popCap).toBe(capWith - provided);
    expect(p.popUsed).toBeLessThanOrEqual(p.popCap);
    const count = units(g, 1).length;
    for (let i = 0; i < 400; i++) step(g);
    expect(units(g, 1).length).toBe(count); // no room: the queued villager never spawns, nobody dies
    expect(tc.queue.length).toBe(1);
  });

  it('a gatherer whose drop-off dies carries on to another drop-off', () => {
    const g = makeGame({ players: 2 });
    const tc = townCenter(g, 1);
    const tree = g.state.entities.find((e): e is ResourceNodeEntity => e.kind === 'node' && e.typeId === 'tree')!;
    const camp = place(g, 'lumberCamp', 1, true, { tx: tree.tile.tx - 3, ty: tree.tile.ty });
    reload(g);
    const v = units(g, 1).find((u) => u.typeId === 'villager')!;
    step(g, [1, { type: 'gather', unitIds: [v.id], nodeId: tree.id, queue: false }]);
    let guard = 0;
    while ((v.currentOrder?.type !== 'gather' || v.currentOrder.phase !== 'toDropOff') && guard++ < 4000) step(g);
    expect(v.currentOrder?.type === 'gather' && v.currentOrder.dropOffId).toBe(camp.id);
    camp.hp = 0;
    const wood = g.state.players[1]!.resources.wood;
    for (let i = 0; i < 1500; i++) step(g);
    expect(byId(g, camp.id)).toBeUndefined();
    expect(g.state.players[1]!.resources.wood).toBeGreaterThan(wood);
    if (v.currentOrder?.type === 'gather') expect(v.currentOrder.dropOffId).not.toBe(camp.id);
    expect(tc.hp).toBeGreaterThan(0);
  });

  it('a builder of a destroyed foundation goes idle and its slot is released', () => {
    const g = makeGame({ players: 2 });
    giveResources(g, 1, 1000);
    const v = units(g, 1).find((u) => u.typeId === 'villager')!;
    const tc = townCenter(g, 1);
    step(g, [1, { type: 'build', unitIds: [v.id], buildingType: 'house', tx: tc.tile.tx + 6, ty: tc.tile.ty, queue: false }]);
    const site = g.state.entities.find((e): e is BuildingEntity => e.kind === 'building' && e.owner === 1 && !e.constructed)!;
    expect(site).toBeDefined();
    for (let i = 0; i < 20; i++) step(g);
    site.hp = 0;
    step(g);
    for (let i = 0; i < 10; i++) step(g);
    expect(byId(g, site.id)).toBeUndefined();
    expect(v.currentOrder === null || (v.currentOrder.type === 'build' && v.currentOrder.buildingId !== site.id)).toBe(true);
    expect(v.hp).toBeGreaterThan(0);
  });

  it('rally points onto a dead building are cleared', () => {
    const g = makeGame({ players: 2 });
    const tc = townCenter(g, 1);
    const house = place(g, 'house', 1);
    reload(g);
    tc.rally = { x: 5, y: 5, targetId: house.id };
    house.hp = 0;
    step(g);
    expect(tc.rally).toEqual({ x: 5, y: 5, targetId: null });
  });
});

describe('defeat rule (4.13)', () => {
  /** Player 2 owns only what `setup` adds; the other player keeps a full base. */
  function defeated(setup: (g: Game) => void): boolean {
    const g = makeGame({ players: 2 });
    clearPlayer(g, 2);
    setup(g);
    reload(g);
    step(g);
    return g.state.players[2]!.outcome === 'defeated';
  }
  const unit = (g: Game, type: string): void => void createUnit(g.state, type, 2, 20.5, 20.5, 1);

  it('truth table', () => {
    expect(defeated((g) => void place(g, 'townCenter', 2))).toBe(false);
    expect(defeated((g) => void place(g, 'barracks', 2))).toBe(false);
    expect(defeated((g) => unit(g, 'villager'))).toBe(false);
    expect(defeated((g) => void place(g, 'barracks', 2, false))).toBe(true); // foundation only
    expect(defeated((g) => void place(g, 'townCenter', 2, false))).toBe(true);
    expect(defeated((g) => void place(g, 'house', 2))).toBe(true); // completed, but trains nothing
    expect(defeated((g) => unit(g, 'spearman'))).toBe(true); // soldiers alone do not keep a player alive
    expect(defeated((g) => { place(g, 'house', 2); unit(g, 'spearman'); })).toBe(true);
    expect(defeated((g) => { place(g, 'barracks', 2, false); unit(g, 'villager'); })).toBe(false); // builder can place a TC
    expect(defeated(() => undefined)).toBe(true);
  });

  it('conquest: the last player standing wins; defeated entities die the next tick', () => {
    const g = makeGame({ players: 2 });
    const mine = g.state.entities.filter((e) => e.owner === 2).map((e) => e.id);
    for (const e of g.state.entities) if (e.owner === 2 && e.kind === 'building') e.hp = 0;
    for (const e of g.state.entities) if (e.owner === 2 && e.kind === 'unit') e.hp = 0;
    const events = step(g);
    expect(events.filter((e) => e.type === 'PlayerDefeated')).toEqual([{ type: 'PlayerDefeated', playerId: 2, reason: 'conquered' }]);
    expect(ofType(events, 'MatchEnded')).toEqual([{ type: 'MatchEnded', winner: 1, tick: 1 }]);
    expect(ofType(events, 'ObjectiveCompleted')).toEqual([{ type: 'ObjectiveCompleted', playerId: 1, objectiveId: 'conquest:1', tick: 1 }]);
    expect(g.state.players[2]).toMatchObject({ outcome: 'defeated', defeatedTick: 1 });
    expect(g.state.players[1]!.outcome).toBe('won');
    expect(g.state.match).toEqual({ mode: 'conquest', winner: 1, endedTick: 1 });
    expect(mine.length).toBeGreaterThan(0);
    // No further events about the match, and the winner keeps playing.
    const later = step(g, [1, { type: 'cheat', cheat: { kind: 'addResources', amounts: { wood: 1 } } }]);
    expect(ofType(later, 'MatchEnded')).toEqual([]);
  });

  it('defeat destroys every remaining entity next tick, with events and no kill credit', () => {
    const g = makeGame({ players: 2 });
    const owned = g.state.entities.filter((e) => e.owner === 2);
    step(g, [2, { type: 'resign' }]);
    // resign applied at once; outcome step zeroed hp but nothing died yet
    expect(g.state.players[2]!.outcome).toBe('defeated');
    expect(owned.every((e) => e.kind === 'node' || e.hp === 0)).toBe(true);
    expect(g.state.entities.filter((e) => e.owner === 2).length).toBe(owned.length);
    const events = step(g);
    expect(g.state.entities.filter((e) => e.owner === 2)).toEqual([]);
    const died = events.filter((e) => e.type === 'UnitDied' || e.type === 'BuildingDestroyed') as { killerPlayerId: number | null }[];
    expect(died.length).toBe(owned.length);
    expect(died.every((e) => e.killerPlayerId === null)).toBe(true);
    expect(g.state.players[1]!.stats.unitsKilled).toBe(0);
  });

  it('resign: reason, immediate outcome, win for the other, repeated resign rejected', () => {
    const g = makeGame({ players: 2 });
    const events = step(g, [1, { type: 'resign' }]);
    expect(events[0]).toEqual({ type: 'PlayerDefeated', playerId: 1, reason: 'resigned' });
    expect(g.state.players[1]).toMatchObject({ outcome: 'defeated', defeatedTick: 1 });
    expect(g.state.match.winner).toBe(2);
    expect(g.state.players[2]!.outcome).toBe('won');
    const again = step(g, [1, { type: 'resign' }]);
    expect(again.filter((e) => e.type === 'CommandRejected')).toMatchObject([{ reason: 'playerDefeated' }]);
    const winnerResigns = step(g, [2, { type: 'resign' }]);
    expect(winnerResigns.filter((e) => e.type === 'CommandRejected')).toMatchObject([{ reason: 'playerDefeated' }]);
  });

  it('commands after defeat are rejected', () => {
    const g = makeGame({ players: 2 });
    step(g, [2, { type: 'resign' }]);
    const v = units(g, 2)[0]!;
    const events = step(g, [2, { type: 'move', unitIds: [v.id], x: 40, y: 40, queue: false }]);
    expect(events.filter((e) => e.type === 'CommandRejected')).toMatchObject([{ reason: 'playerDefeated' }]);
  });

  it('draw: both players defeated on the same tick', () => {
    const g = makeGame({ players: 2 });
    clearPlayer(g, 1);
    clearPlayer(g, 2);
    const events = step(g);
    expect(events.filter((e) => e.type === 'PlayerDefeated').length).toBe(2);
    expect(ofType(events, 'MatchEnded')).toEqual([{ type: 'MatchEnded', winner: null, tick: 1 }]);
    expect(ofType(events, 'ObjectiveCompleted')).toEqual([]);
    expect(g.state.match).toEqual({ mode: 'conquest', winner: null, endedTick: 1 });
    expect(g.state.players[1]!.outcome).toBe('defeated');
  });

  it('sandbox never ends: no defeat checks, no match end', () => {
    const g = makeGame({ players: 1 });
    clearPlayer(g, 1);
    for (let i = 0; i < 5; i++) step(g);
    expect(g.state.players[1]!.outcome).toBe('playing');
    expect(g.state.match).toEqual({ mode: 'sandbox', winner: null, endedTick: null });
    // A three-player match is a sandbox too.
    const g3 = makeGame({ players: 3 });
    for (const e of g3.state.entities) if (e.kind !== 'node' && e.owner !== 1) e.hp = 0;
    for (let i = 0; i < 5; i++) step(g3);
    expect(g3.state.match.endedTick).toBeNull();
    expect(g3.state.players[2]!.outcome).toBe('playing');
  });

  it('a one-player conquest config never ends', () => {
    const g = createGame({ seed: 3, mapSize: 120, mode: 'conquest', players: [{ civ: 'byzantines' }] });
    for (let i = 0; i < 5; i++) g.step([]);
    expect(g.state.match.endedTick).toBeNull();
  });
});

describe('determinism and save/load around deaths and defeat', () => {
  const config: GameConfig = { seed: 21, mapSize: 120, players: [{ civ: 'byzantines' }, { civ: 'byzantines' }] };

  /** Scripted run: kill some units at tick 5, a building at 40, resign player 2 at 90. Returns hashes and events. */
  function run(saveAt: number | null): { hashes: string[]; events: string } {
    let sim = createGame(config);
    const hashes: string[] = [];
    const log: SimEvent[] = [];
    for (let t = 0; t < 200; t++) {
      const cmds = [];
      const state = sim.state as GameState;
      if (t === 5) for (const e of state.entities) if (e.kind === 'unit' && e.owner === 2) { e.hp = 0; break; }
      if (t === 40) for (const e of state.entities) if (e.kind === 'building' && e.owner === 1) { e.hp = 0; break; }
      if (t === 90) cmds.push({ type: 'resign' as const, playerId: 2, seq: 1 });
      log.push(...sim.step(cmds));
      hashes.push(hashState(sim.state));
      if (saveAt === t) sim = deserialize(serialize(sim));
    }
    return { hashes, events: JSON.stringify(log) };
  }

  it('two runs are identical, and a save/load at any of several ticks does not change the run', () => {
    const base = run(null);
    expect(run(null)).toEqual(base);
    for (const t of [6, 41, 89, 91, 100]) expect(run(t), `save at ${t}`).toEqual(base);
    expect(base.events).toContain('"MatchEnded"');
    expect(base.events).toContain('"UnitDied"');
    expect(base.events).toContain('"BuildingDestroyed"');
  });

  it('ctx helper is usable on a finished match', () => {
    const g = makeGame({ players: 2 });
    step(g, [2, { type: 'resign' }]);
    expect(ctxOf(g).state.match.winner).toBe(1);
  });
});
