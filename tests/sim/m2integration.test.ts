/**
 * Phase 2 integration (PLAN-M2 9.5): the four sim packages together through the real tick order. Hand-built states on
 * an empty grass map with the real content; no system is stubbed or driven by hand.
 *
 * (a) 10 archers + 10 spearmen a side, attack-moving into each other, fight to one side's elimination, identically
 *     across two runs and across save/load every 100 ticks;
 * (b) an army destroys an undefended base and the 4.13 defeat rule ends the match with `MatchEnded`;
 * (c) villagers repair a Town Center while archers shoot it;
 * (d) a Town Center's arrows kill a lone attacker (projectile kill credit);
 * (e) swapping the creation order of the two sides of a mirrored fight changes nothing but ids;
 * plus the cross-package acceptances that waited for integration: ranged kills (WP21 with WP22's flight) and
 * projectile kill credit and stats (WP22 with WP23).
 */

import { describe, expect, it } from 'vitest';
import { registry } from '../../src/data/index';
import { createBuilding, createUnit, findEntity } from '../../src/sim/entities';
import { hashState } from '../../src/sim/hash';
import { rebuildRuntime } from '../../src/sim/runtime';
import { deserialize, serialize } from '../../src/sim/serialize';
import { createInitialState, simFromState } from '../../src/sim/sim';
import { rebuildSpatialIndex } from '../../src/sim/systems/combat/spatial';
import { scanBuildingTarget } from '../../src/sim/systems/defence';
import {
  ACQUIRE_INTERVAL_TICKS,
  ACQUIRE_MAX_CHECKS_PER_SCAN,
  type BuildingEntity,
  type Command,
  type GameState,
  type MatchMode,
  type PlayerId,
  type Sim,
  type SimContext,
  type SimEvent,
  type UnitEntity,
} from '../../src/sim/types';

const SIZE = 48;

function emptyState(mode: MatchMode, size = SIZE): GameState {
  return createInitialState({ seed: 3, mapSize: size, players: [{ civ: 'byzantines' }, { civ: 'byzantines' }], mode }, registry);
}

class Driver {
  sim: Sim;
  events: SimEvent[] = [];
  private seq = 0;
  constructor(state: GameState) {
    this.sim = simFromState(state, registry);
  }
  get state(): GameState {
    return this.sim.state as unknown as GameState;
  }
  cmd(playerId: PlayerId, c: Record<string, unknown>): Command {
    this.seq += 1;
    return { ...c, playerId, seq: this.seq } as unknown as Command;
  }
  step(commands: readonly Command[] = []): SimEvent[] {
    const ev = this.sim.step(commands);
    this.events.push(...ev);
    return ev;
  }
  /** Steps until `done()` holds after a step; returns the steps taken or -1 after `max`. */
  until(done: () => boolean, max: number): number {
    for (let i = 1; i <= max; i++) {
      this.step();
      if (done()) return i;
    }
    return -1;
  }
  units(owner: PlayerId): UnitEntity[] {
    return this.state.entities.filter((e): e is UnitEntity => e.kind === 'unit' && e.owner === owner);
  }
  unit(id: number): UnitEntity | undefined {
    const e = findEntity(this.state, id);
    return e !== undefined && e.kind === 'unit' ? e : undefined;
  }
  building(id: number): BuildingEntity | undefined {
    const e = findEntity(this.state, id);
    return e !== undefined && e.kind === 'building' ? e : undefined;
  }
}

function ofType<T extends SimEvent['type']>(events: readonly SimEvent[], type: T): Extract<SimEvent, { type: T }>[] {
  return events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

// ---------------------------------------------------------------------------
// Cross-package acceptances that waited for integration
// ---------------------------------------------------------------------------

describe('ranged kills and projectile credit (WP21 + WP22 + WP23)', () => {
  it('an archer kills a villager through its projectiles; the kill is credited and counted', () => {
    const s = emptyState('sandbox');
    const archer = createUnit(s, 'archer', 1, 10.5, 10.5).id;
    const vil = createUnit(s, 'villager', 2, 14.5, 10.5).id;
    const d = new Driver(s);
    d.step([d.cmd(1, { type: 'attack', unitIds: [archer], targetId: vil, queue: false })]);
    expect(d.until(() => d.unit(vil) === undefined, 2000)).toBeGreaterThan(0);
    const died = ofType(d.events, 'UnitDied');
    expect(died).toHaveLength(1);
    expect(died[0]).toMatchObject({ unitId: vil, playerId: 2, killerPlayerId: 1 });
    expect(d.state.players[1]!.stats.unitsKilled).toBe(1);
    expect(d.state.players[2]!.stats.unitsLost).toBe(1);
    // The archer's order ends with the target and it stands (no further shots at nothing).
    d.step();
    expect(d.unit(archer)!.currentOrder).toBeNull();
  });

  it('a projectile still in flight when its shooter dies still kills and credits the shooter', () => {
    const s = emptyState('sandbox');
    const archer = createUnit(s, 'archer', 1, 10.5, 10.5);
    const vil = createUnit(s, 'villager', 2, 15.5, 10.5);
    vil.hp = 1;
    const d = new Driver(s);
    d.step([d.cmd(1, { type: 'attack', unitIds: [archer.id], targetId: vil.id, queue: false })]);
    expect(d.until(() => d.state.projectiles.length > 0, 200)).toBeGreaterThan(0);
    // Kill the shooter with the arrow in the air (cheat setHp, applied next tick).
    d.step([d.cmd(1, { type: 'cheat', cheat: { kind: 'setHp', entityId: archer.id, hp: 0 } })]);
    expect(d.unit(archer.id)).toBeUndefined();
    expect(d.state.projectiles.length).toBeGreaterThan(0);
    expect(d.until(() => d.unit(vil.id) === undefined, 200)).toBeGreaterThan(0);
    const died = ofType(d.events, 'UnitDied').find((e) => e.unitId === vil.id);
    expect(died?.killerPlayerId).toBe(1);
  });

  it('two identical archers duelling die on the same tick in either id order', () => {
    const deathTicks = (lowLeft: boolean): [number, number] => {
      const s = emptyState('sandbox');
      let l: number;
      let r: number;
      if (lowLeft) {
        l = createUnit(s, 'archer', 1, 10.5, 20.5).id;
        r = createUnit(s, 'archer', 2, 15.5, 20.5).id;
      } else {
        r = createUnit(s, 'archer', 2, 15.5, 20.5).id;
        l = createUnit(s, 'archer', 1, 10.5, 20.5).id;
      }
      const d = new Driver(s);
      d.step([d.cmd(1, { type: 'attack', unitIds: [l], targetId: r, queue: false }), d.cmd(2, { type: 'attack', unitIds: [r], targetId: l, queue: false })]);
      const at: Record<number, number> = {};
      for (let i = 0; i < 3000 && Object.keys(at).length < 2; i++) {
        for (const e of ofType(d.step(), 'UnitDied')) at[e.unitId] = d.state.tick;
      }
      return [at[l]!, at[r]!];
    };
    const a = deathTicks(true);
    const b = deathTicks(false);
    expect(a[0]).toBeGreaterThan(0);
    expect(a[1]).toBe(a[0]);
    expect(b).toEqual(a);
  });
});

// ---------------------------------------------------------------------------
// (a) A 20-a-side battle to elimination, deterministic through save/load
// ---------------------------------------------------------------------------

describe('(a) 10 archers + 10 spearmen a side', () => {
  const W = 64;

  function setup(): Driver {
    const s = emptyState('sandbox', W);
    for (let i = 0; i < 20; i++) {
      const type = i < 10 ? 'archer' : 'spearman';
      // Spearmen in front (towards the enemy), archers behind; side 2 is the point mirror of side 1.
      const x = (type === 'archer' ? 14.5 : 18.5) + (i % 2) * 0.9;
      const y = 22.5 + (i % 10) * 1.1 + (i % 3) * 0.13;
      createUnit(s, type, 1, x, y);
      createUnit(s, type, 2, W - x, W - y);
    }
    const d = new Driver(s);
    const ids = (o: PlayerId): number[] => d.units(o).map((u) => u.id);
    d.step([d.cmd(1, { type: 'attackMove', unitIds: ids(1), x: W - 18, y: W - 27, queue: false }), d.cmd(2, { type: 'attackMove', unitIds: ids(2), x: 18, y: 27, queue: false })]);
    return d;
  }

  const eliminated = (d: Driver): boolean => d.units(1).length === 0 || d.units(2).length === 0;
  const MAX = 6000;

  function play(saveEvery: number | null): { hashes: string[]; d: Driver } {
    let d = setup();
    const hashes: string[] = [];
    for (let t = 0; t < MAX && !eliminated(d); t++) {
      d.step();
      if (d.state.tick % 100 === 0) {
        hashes.push(`${d.state.tick}:${hashState(d.state)}`);
        if (saveEvery !== null) {
          const events = d.events;
          const next = new Driver(deserialize(serialize(d.sim)).state as unknown as GameState);
          next.events = events;
          expect(hashState(next.state)).toBe(hashState(d.state));
          d = next;
        }
      }
    }
    hashes.push(`end ${d.state.tick}:${hashState(d.state)}`);
    return { hashes, d };
  }

  it('runs to one side\'s elimination; two runs and a run with save/load every 100 ticks agree', () => {
    const a = play(null);
    expect(eliminated(a.d)).toBe(true);
    const died = ofType(a.d.events, 'UnitDied');
    // Both sides lost units: it was a battle, not a walk-over.
    expect(died.some((e) => e.playerId === 1)).toBe(true);
    expect(died.some((e) => e.playerId === 2)).toBe(true);
    expect(died.every((e) => e.killerPlayerId !== null && e.killerPlayerId !== e.playerId)).toBe(true);
    expect(play(null).hashes).toEqual(a.hashes);
    expect(play(100).hashes).toEqual(a.hashes);
  });
});

// ---------------------------------------------------------------------------
// (b) Conquest: an army razes an undefended base; the defeat rule ends the match
// ---------------------------------------------------------------------------

describe('(b) an army destroys an undefended base', () => {
  it('the defender loses its last producer and Town-Center builder, is defeated, and the match ends', () => {
    const s = emptyState('conquest');
    // Attacker: a producer far away keeps it in the game, and an army.
    createBuilding(s, 'barracks', 1, 2, 2, true);
    const army: number[] = [];
    for (let i = 0; i < 6; i++) army.push(createUnit(s, i < 4 ? 'swordsman' : 'spearman', 1, 10.5 + (i % 3), 30.5 + Math.floor(i / 3)).id);
    // Defender: a Barracks (its only producer), a House and two villagers (Town-Center builders). No Town Center.
    const barracks = createBuilding(s, 'barracks', 2, 32, 32, true).id;
    createBuilding(s, 'house', 2, 38, 32, true);
    createUnit(s, 'villager', 2, 36.5, 37.5);
    createUnit(s, 'villager', 2, 37.5, 37.5);
    const d = new Driver(s);
    d.step();
    expect(d.state.match.endedTick).toBeNull(); // both sides alive: the match runs
    d.step([d.cmd(1, { type: 'attack', unitIds: army, targetId: barracks, queue: false })]);
    expect(d.until(() => d.building(barracks) === undefined, 20000)).toBeGreaterThan(0);
    // With the producer gone, the army mops up the villagers (idle units acquire them in sight, or by attack-move).
    d.step([d.cmd(1, { type: 'attackMove', unitIds: d.units(1).map((u) => u.id), x: 37, y: 37, queue: false })]);
    expect(d.until(() => d.state.match.endedTick !== null, 20000)).toBeGreaterThan(0);
    const defeated = ofType(d.events, 'PlayerDefeated');
    expect(defeated).toEqual([expect.objectContaining({ playerId: 2, reason: 'conquered' })]);
    const ended = ofType(d.events, 'MatchEnded');
    expect(ended).toHaveLength(1);
    expect(ended[0]!.winner).toBe(1);
    expect(d.state.players[1]!.outcome).toBe('won');
    expect(d.state.players[2]!.outcome).toBe('defeated');
    expect(d.state.match.winner).toBe(1);
    expect(d.state.objectives.entries.find((o) => o.id === 'conquest:1')?.completedTick).not.toBeNull();
    // The defeated player's remaining entities (the House) are destroyed on the next tick.
    d.step();
    d.step();
    expect(d.state.entities.filter((e) => e.owner === 2)).toHaveLength(0);
    // The Barracks is credited; the House is credited only if the army hit it before the defeat (the destruction of
    // a defeated player's entities clears lastAttackerId, WP23).
    const credited = ofType(d.events, 'BuildingDestroyed').filter((e) => e.killerPlayerId === 1).length;
    expect(credited).toBeGreaterThanOrEqual(1);
    expect(d.state.players[1]!.stats.buildingsDestroyed).toBe(credited);
    expect(d.state.players[2]!.stats.buildingsLost).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// (c) Repair under fire
// ---------------------------------------------------------------------------

describe('(c) villagers repair a Town Center under fire', () => {
  it('hp rises while archers keep hitting it, and the repair is paid for', () => {
    const s = emptyState('sandbox');
    const tc = createBuilding(s, 'townCenter', 1, 20, 20, true);
    const maxHp = tc.hp;
    tc.hp = Math.floor(maxHp / 2);
    const vils = [createUnit(s, 'villager', 1, 19.5, 22.5).id, createUnit(s, 'villager', 1, 19.5, 23.5).id, createUnit(s, 'villager', 1, 24.5, 22.5).id];
    // Six archers south of it. The Town Center outranges them (7.75 from its centre vs 5.75 from the footprint), so
    // it shoots back and they die one by one, but they keep it under fire for most of the run.
    const archers: number[] = [];
    for (let i = 0; i < 6; i++) archers.push(createUnit(s, 'archer', 2, 19.5 + i, 30.5 + (i % 2) * 0.5).id);
    // Repair costs every resource of the def's cost (4.12): the Town Center costs stone, which a start lacks.
    s.players[1]!.resources.stone = 200;
    const d = new Driver(s);
    const wood0 = d.state.players[1]!.resources.wood;
    d.step([d.cmd(2, { type: 'attack', unitIds: archers, targetId: tc.id, queue: false }), d.cmd(1, { type: 'repair', unitIds: vils, buildingId: tc.id, queue: false })]);
    const hp0 = d.building(tc.id)!.hp;
    let hits = 0;
    let prev = hp0;
    let minHp = hp0;
    for (let i = 0; i < 400; i++) {
      d.step();
      const b = d.building(tc.id)!;
      if (b.lastDamagedTick === d.state.tick - 1) hits += 1;
      minHp = Math.min(minHp, b.hp);
      prev = b.hp;
    }
    expect(d.units(2).length).toBeGreaterThan(0); // still shooting at the end
    expect(hits).toBeGreaterThan(30); // it really was under fire throughout (a volley of six lands about every 40 ticks)
    expect(d.building(tc.id)!.repairerIds.length).toBe(3);
    expect(prev).toBeGreaterThan(hp0); // three repairers outpace the archers' arrows
    expect(d.state.players[1]!.resources.wood).toBeLessThan(wood0); // and it costs resources
    expect(d.state.players[1]!.resources.stone).toBeLessThan(200);
    expect(minHp).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// (d) Town Center arrows kill a lone attacker
// ---------------------------------------------------------------------------

describe('(d) a Town Center defends itself', () => {
  it('its arrows kill a swordsman attacking it; the kill is credited to the Town Center\'s owner', () => {
    const s = emptyState('sandbox');
    const tc = createBuilding(s, 'townCenter', 1, 20, 20, true);
    const sword = createUnit(s, 'swordsman', 2, 32.5, 22.5).id;
    const d = new Driver(s);
    d.step([d.cmd(2, { type: 'attack', unitIds: [sword], targetId: tc.id, queue: false })]);
    expect(d.until(() => d.unit(sword) === undefined, 4000)).toBeGreaterThan(0);
    const died = ofType(d.events, 'UnitDied');
    expect(died).toEqual([expect.objectContaining({ unitId: sword, playerId: 2, killerPlayerId: 1 })]);
    const b = d.building(tc.id)!;
    expect(b.hp).toBeGreaterThan(0);
    expect(b.hp).toBeLessThan(registry.building('townCenter').combat.hp); // the swordsman did reach it and hit it
    expect(d.state.players[1]!.stats.unitsKilled).toBe(1);
    d.step(); // step 8b drops the dead target
    expect(b.attack!.targetId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (e) Id-permutation independence of a mirrored fight
// ---------------------------------------------------------------------------

describe('(e) creation order of the two sides', () => {
  // Ten units a side. Units start with `nextScanTick = tick + id % 10` (PLAN-M2 3.6 entity defaults), so a scan's
  // phase follows the id; with ten a side, swapping which side is created first shifts every id by exactly 10 and
  // keeps each unit's phase. (With other sizes the stagger legitimately differs, by that plan rule.)
  const ROSTER = ['spearman', 'swordsman', 'archer', 'archer', 'horseman', 'spearman', 'archer', 'swordsman', 'spearman', 'archer'];
  // Distinct, irregular offsets so that no two candidates are ever exactly equidistant (ties go by id, by rule) and
  // no two units ever coincide (coincident units split along a direction picked by id, the M1 separation rule).
  const SPOTS: readonly [number, number][] = [
    [12.3, 20.1], [11.1, 23.7], [9.4, 21.2], [8.2, 24.9], [13.6, 26.3],
    [12.9, 17.4], [7.3, 18.6], [10.7, 27.8], [14.2, 22.9], [6.1, 22.3],
  ];

  interface Snapshot {
    tick: number;
    rows: string[];
    projectiles: string[];
  }

  function fight(side1First: boolean): Snapshot[] {
    const s = emptyState('sandbox');
    const slotOf = new Map<number, string>();
    const make = (owner: PlayerId): void => {
      ROSTER.forEach((type, i) => {
        const [x, y] = SPOTS[i]!;
        const u = owner === 1 ? createUnit(s, type, 1, x, y) : createUnit(s, type, 2, SIZE - x, SIZE - y);
        slotOf.set(u.id, `${owner}/${i}`);
      });
    };
    if (side1First) {
      make(1);
      make(2);
    } else {
      make(2);
      make(1);
    }
    const d = new Driver(s);
    const ids = (o: PlayerId): number[] => d.units(o).map((u) => u.id);
    d.step([d.cmd(1, { type: 'attackMove', unitIds: ids(1), x: 36, y: 26, queue: false }), d.cmd(2, { type: 'attackMove', unitIds: ids(2), x: 12, y: 22, queue: false })]);
    const slot = (id: number | null): string => (id === null ? '-' : (slotOf.get(id) ?? `?${id}`));
    const snaps: Snapshot[] = [];
    for (let t = 0; t < 2500; t++) {
      d.step();
      if (d.state.tick % 10 !== 0) continue;
      const rows = d.state.entities
        .filter((e): e is UnitEntity => e.kind === 'unit')
        .map((u) => {
          const o = u.currentOrder;
          const target = o !== null && 'targetId' in o ? slot((o as { targetId: number | null }).targetId) : '-';
          return `${slot(u.id)} ${u.pos.x},${u.pos.y} hp${u.hp} f${u.facing} ${o?.type ?? 'idle'}:${(o as { phase?: string } | null)?.phase ?? ''}>${target} w${u.combat.windup} c${u.combat.cooldown}`;
        })
        .sort();
      const projectiles = d.state.projectiles.map((p) => `${slot(p.sourceId)}>${slot(p.targetId)} ${p.ticksLeft} ${p.damage}`).sort();
      snaps.push({ tick: d.state.tick, rows, projectiles });
      if (d.units(1).length === 0 || d.units(2).length === 0) break;
    }
    return snaps;
  }

  it('swapping which side is created first flips only the ids', () => {
    const a = fight(true);
    const b = fight(false);
    expect(a.length).toBeGreaterThan(10);
    expect(b).toEqual(a);
    // And it was a real fight.
    const last = a[a.length - 1]!;
    expect(last.rows.length).toBeLessThan(2 * ROSTER.length);
  });
});

// ---------------------------------------------------------------------------
// Integration rules wired in Phase 2
// ---------------------------------------------------------------------------

describe('integration rules', () => {
  it('a unit winding up does not move, even after a move order; the blow lands, then it walks', () => {
    const s = emptyState('sandbox');
    const me = createUnit(s, 'spearman', 1, 10.5, 10.5).id;
    const vil = createUnit(s, 'villager', 2, 11.5, 10.5).id;
    const d = new Driver(s);
    d.step([d.cmd(1, { type: 'attack', unitIds: [me], targetId: vil, queue: false })]);
    expect(d.until(() => d.unit(me)!.combat.windup > 0, 100)).toBeGreaterThan(0);
    const at = { ...d.unit(me)!.pos };
    const hp0 = d.unit(vil)!.hp;
    d.step([d.cmd(1, { type: 'move', unitIds: [me], x: 30.5, y: 10.5, queue: false })]);
    while (d.unit(me)!.combat.windup > 0) {
      expect(d.unit(me)!.pos).toEqual(at);
      d.step();
    }
    expect(d.unit(me)!.pos).toEqual(at); // the release tick: still in place
    expect(d.unit(vil)!.hp).toBeLessThan(hp0);
    d.until(() => d.unit(me)!.pos.x > at.x + 1, 200);
    expect(d.unit(me)!.currentOrder?.type).toBe('move');
  });

  it('a Town Center scan waits, like a unit, while less than a full scan is left in the shared budget', () => {
    const s = emptyState('sandbox');
    const tc = createBuilding(s, 'townCenter', 1, 20, 20, true);
    const foe = createUnit(s, 'spearman', 2, 25.5, 22.5);
    const ctx: SimContext = { state: s, runtime: rebuildRuntime(s, registry), data: registry, events: [] };
    rebuildSpatialIndex(ctx);
    tc.attack!.nextScanTick = 0;
    ctx.runtime.acquireBudget = ACQUIRE_MAX_CHECKS_PER_SCAN - 1;
    scanBuildingTarget(ctx, tc);
    expect(tc.attack!.targetId).toBeNull();
    expect(tc.attack!.nextScanTick).toBe(0); // still due
    ctx.runtime.acquireBudget = ACQUIRE_MAX_CHECKS_PER_SCAN;
    scanBuildingTarget(ctx, tc);
    expect(tc.attack!.targetId).toBe(foe.id);
    expect(tc.attack!.nextScanTick).toBe(ACQUIRE_INTERVAL_TICKS);
    expect(ctx.runtime.acquireBudget).toBe(ACQUIRE_MAX_CHECKS_PER_SCAN - 1); // one candidate looked at
  });
});
