/**
 * WP20 (Milestone 2, Phase 0): the contracts the parallel packages build against.
 *
 * - The real shared helpers: `computeDamage` (PLAN-M2 4.1), `applyDamage` (hp, attacker, alerts, retaliation
 *   wake-up), `isEnemy`, `distSqToTarget`, `unitCombat`/`buildingCombat`, `spawnProjectile`, `recordStat` calls.
 * - Defaults: GameConfig (colours, controllers, names, mode, objectives), entity creation, construction hp.
 * - Command intake: new shapes, the defeated-player rejection, the M2 cheats.
 * - Save v2: the v1 -> v2 migration (byte-exact against `save-v1-as-v2.json`), the v2 fixture round trip and
 *   continuation, controllers, damaged files.
 * - A 2-player `createGame` runs 1,000 ticks deterministically with the combat stubs.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AiPlayer, EconomyBot } from '../../src/bot';
import { registry } from '../../src/data';
import {
  createGame,
  deserialize,
  deserializeSave,
  hashState,
  SaveError,
  serialize,
  type BuildingEntity,
  type Command,
  type CommandInput,
  type GameConfig,
  type Sim,
  type SimContext,
  type SimEvent,
  type UnitEntity,
} from '../../src/sim';
import { createBuilding, createUnit } from '../../src/sim/entities';
import { rebuildRuntime } from '../../src/sim/runtime';
import { createInitialState } from '../../src/sim/sim';
import { applyDamage, buildingCombat, computeDamage, distSqToTarget, isEnemy, unitCombat } from '../../src/sim/systems/combat/damage';
import { spawnProjectile } from '../../src/sim/systems/projectiles';
import { ACQUIRE_INTERVAL_TICKS, PLAYER_COLORS, SAVE_VERSION } from '../../src/sim/types';
import { buildV2Fixture } from './m2fixtures';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const V1 = join(FIXTURES, 'save-v1.json');
const V1_AS_V2 = join(FIXTURES, 'save-v1-as-v2.json');
const V2 = join(FIXTURES, 'save-v2.json');
const UPDATE = process.env.UPDATE_SAVE_FIXTURE === '1';

const TWO: GameConfig = { seed: 9, mapSize: 120, players: [{ civ: 'byzantines' }, { civ: 'byzantines' }] };

/** A bare 2-player context on a small empty map (no map generation). */
function bareCtx(): SimContext {
  const state = createInitialState({ seed: 1, mapSize: 40, players: [{ civ: 'byzantines' }, { civ: 'byzantines' }] }, registry);
  return { state, runtime: rebuildRuntime(state, registry), data: registry, events: [] };
}

class Driver {
  readonly sim: Sim;
  private seq = 1;
  constructor(config: GameConfig = TWO) {
    this.sim = createGame(config);
  }
  step(inputs: CommandInput[] = [], playerId = 1): SimEvent[] {
    return this.sim.step(inputs.map((c) => ({ ...c, playerId, seq: this.seq++ }) as Command));
  }
  rejections(events: SimEvent[]): string[] {
    return events.flatMap((e) => (e.type === 'CommandRejected' ? [e.reason] : []));
  }
  units(owner: number): UnitEntity[] {
    return this.sim.state.entities.filter((e) => e.kind === 'unit' && e.owner === owner) as UnitEntity[];
  }
}

// ---------------------------------------------------------------------------
// Damage and the shared helpers
// ---------------------------------------------------------------------------

describe('computeDamage (PLAN-M2 4.1)', () => {
  const ctx = bareCtx();
  const u = (id: string) => unitCombat(ctx, 1, id);
  const b = (id: string) => buildingCombat(ctx, 1, id);
  const MIN = registry.combat.minDamage;

  it.each([
    ['spearman', 'horseman', 5 - 1 + 12],
    ['spearman', 'cataphract', 5 - 3 + 6], // 50% resist halves +12
    ['spearman', 'swordsman', 5 - 2],
    ['swordsman', 'spearman', 8 - 0 + 4],
    ['archer', 'swordsman', 5 - 1 + 4], // pierce against pierce armour
    ['archer', 'batteringRam', 1], // armour floor at minDamage
    ['horseman', 'archer', 6 + 5],
    ['horseman', 'trebuchet', 6 + 8],
    ['villager', 'batteringRam', 3],
  ] as const)('%s hits %s for %i', (att, def, expected) => {
    expect(computeDamage(u(att), u(def), MIN)).toBe(expected);
  });

  it('bonus against buildings is added after armour', () => {
    expect(computeDamage(u('batteringRam'), b('barracks'), MIN)).toBe(4 - 2 + 60);
    expect(computeDamage(u('trebuchet'), b('townCenter'), MIN)).toBe(1 + 150);
    expect(computeDamage(u('archer'), b('house'), MIN)).toBe(1);
  });

  it('resist floors the bonus; outputs are integers; minDamage is a parameter', () => {
    const att = { attack: 2, attackType: 'melee' as const, bonus: { cavalry: 5 } };
    const def = { meleeArmor: 4, pierceArmor: 0, classes: ['cavalry' as const], bonusResist: 50 };
    expect(computeDamage(att, def, 1)).toBe(1 + 2); // floor(2.5)
    expect(computeDamage(att, def, 3)).toBe(3 + 2);
    expect(computeDamage({ ...att, bonus: { cavalry: 5, infantry: 3 } }, { ...def, classes: ['cavalry', 'infantry'] }, 1)).toBe(1 + 4);
    for (const a of registry.units) for (const d of registry.units) expect(Number.isInteger(computeDamage(u(a.id), u(d.id), MIN))).toBe(true);
  });
});

describe('isEnemy, distSqToTarget, combat profiles', () => {
  it('isEnemy: different real players only', () => {
    expect(isEnemy(1, 2)).toBe(true);
    expect(isEnemy(2, 1)).toBe(true);
    expect(isEnemy(1, 1)).toBe(false);
    expect(isEnemy(0, 1)).toBe(false);
    expect(isEnemy(2, 0)).toBe(false);
  });

  it('distSqToTarget: unit centre, or the nearest point of a footprint', () => {
    const ctx = bareCtx();
    const unit = createUnit(ctx.state, 'spearman', 2, 10.5, 10.5);
    const house = createBuilding(ctx.state, 'house', 2, 20, 20, true); // [20, 22] x [20, 22]
    expect(distSqToTarget(ctx, 13.5, 14.5, unit)).toBe(9 + 16);
    expect(distSqToTarget(ctx, 21, 21, house)).toBe(0);
    expect(distSqToTarget(ctx, 25, 21, house)).toBe(9);
    expect(distSqToTarget(ctx, 17, 17, house)).toBe(18);
  });

  it('profiles: ticks, reach, classes, building attack, upgrades', () => {
    const ctx = bareCtx();
    const spear = unitCombat(ctx, 1, 'spearman');
    expect(spear).toMatchObject({ maxHp: 50, windupTicks: 10, cooldownTicks: 40, reach: 0.75, classes: ['infantry', 'spear'], autoAcquire: true });
    expect(unitCombat(ctx, 1, 'archer')).toMatchObject({ reach: 5.75, projectile: 'arrow', attackType: 'pierce', windupTicks: 12 });
    expect(unitCombat(ctx, 1, 'trebuchet')).toMatchObject({ minRange: 3, reach: 11.75, targets: 'buildings', cooldownTicks: 160 });
    expect(unitCombat(ctx, 1, 'villager').autoAcquire).toBe(false);
    expect(unitCombat(ctx, 1, 'siphonarios').splash).toEqual({ radius: 1, percent: 60 });
    expect(buildingCombat(ctx, 1, 'townCenter')).toMatchObject({
      maxHp: 2400, meleeArmor: 3, pierceArmor: 8, classes: ['building'],
      attack: { attack: 5, attackType: 'pierce', range: 7, reach: 7.75, cooldownTicks: 40, arrows: 2, projectile: 'arrow' },
    });
    expect(buildingCombat(ctx, 1, 'house').attack).toBeNull();
    // Upgrades resolve through the stat table and the profiles.
    ctx.state.players[1]!.researched.push('spathionForging', 'strategikonDrill', 'hornSinewBows', 'solenarionGuides', 'ironHorseBards');
    const upgraded: SimContext = { ...ctx, runtime: rebuildRuntime(ctx.state, registry) };
    expect(unitCombat(upgraded, 1, 'swordsman').attack).toBe(10);
    expect(unitCombat(upgraded, 1, 'siphonarios').attack).toBe(10); // not an infantry attack target
    expect(unitCombat(upgraded, 1, 'archer')).toMatchObject({ attack: 7, range: 6, reach: 6.75 });
    expect(unitCombat(upgraded, 1, 'cataphract')).toMatchObject({ meleeArmor: 4, pierceArmor: 5 });
    expect(unitCombat(upgraded, 2, 'swordsman').attack).toBe(8);
  });
});

describe('applyDamage (PLAN-M2 3.5, 4.14)', () => {
  it('lowers hp clamped at 0, records the attacker only while alive, and stamps the tick', () => {
    const ctx = bareCtx();
    const target = createUnit(ctx.state, 'spearman', 2, 10.5, 10.5);
    ctx.state.tick = 7;
    applyDamage(ctx, target, 20, { id: 99, owner: 1 });
    expect(target).toMatchObject({ hp: 30, lastAttackerId: 99, lastDamagedTick: 7 });
    applyDamage(ctx, target, 45, { id: 98, owner: 1 });
    expect(target).toMatchObject({ hp: 0, lastAttackerId: 98 });
    applyDamage(ctx, target, 5, { id: 97, owner: 1 });
    expect(target).toMatchObject({ hp: 0, lastAttackerId: 98 });
  });

  it('throttles UnderAttack per player: new alert after 100 ticks or 12 tiles away', () => {
    const ctx = bareCtx();
    const a = createUnit(ctx.state, 'villager', 2, 10.5, 10.5);
    const near = createUnit(ctx.state, 'villager', 2, 15.5, 10.5);
    const far = createUnit(ctx.state, 'villager', 2, 30.5, 10.5);
    const tc = createBuilding(ctx.state, 'townCenter', 2, 30, 30, true);
    const alerts = (): SimEvent[] => ctx.events.filter((e) => e.type === 'UnderAttack');
    ctx.state.tick = 100;
    applyDamage(ctx, a, 1, { id: 50, owner: 1 });
    expect(alerts()).toEqual([
      { type: 'UnderAttack', playerId: 2, entityId: a.id, entityKind: 'unit', townCenter: false, x: 10.5, y: 10.5, attackerPlayerId: 1 },
    ]);
    ctx.state.tick = 150;
    applyDamage(ctx, near, 1, { id: 50, owner: 1 });
    expect(alerts()).toHaveLength(1);
    applyDamage(ctx, far, 1, { id: 50, owner: 1 }); // 20 tiles from the last alert
    expect(alerts()).toHaveLength(2);
    ctx.state.tick = 249;
    applyDamage(ctx, far, 1, { id: 50, owner: 1 });
    expect(alerts()).toHaveLength(2);
    ctx.state.tick = 250;
    applyDamage(ctx, tc, 1, { id: 50, owner: 1 });
    expect(alerts()[2]).toMatchObject({ entityKind: 'building', townCenter: true, x: 32, y: 32 });
    expect(ctx.state.players[2]!.alert).toEqual({ tick: 250, x: 32, y: 32 });
    // Not from an enemy: no alert.
    ctx.state.tick = 1000;
    applyDamage(ctx, a, 1, { id: near.id, owner: 2 });
    expect(alerts()).toHaveLength(3);
  });

  it('wakes an idle aggressive fighting unit for retaliation, not villagers or busy units', () => {
    const ctx = bareCtx();
    const idle = createUnit(ctx.state, 'spearman', 2, 10.5, 10.5);
    const stand = createUnit(ctx.state, 'spearman', 2, 11.5, 10.5);
    stand.stance = 'standGround';
    const villager = createUnit(ctx.state, 'villager', 2, 12.5, 10.5);
    const busy = createUnit(ctx.state, 'spearman', 2, 13.5, 10.5);
    busy.currentOrder = { type: 'move', x: 1, y: 1, phase: 'walking' };
    ctx.state.tick = 500;
    const before = [stand, villager, busy].map((u) => u.combat.nextScanTick);
    for (const u of [idle, stand, villager, busy]) applyDamage(ctx, u, 1, { id: 77, owner: 1 });
    expect(idle.combat.nextScanTick).toBe(501);
    expect([stand, villager, busy].map((u) => u.combat.nextScanTick)).toEqual(before);
  });
});

describe('projectiles (spawn real, flight stubbed)', () => {
  it('spawnProjectile allocates ascending ids and sets ticksLeft; the stub drops spent projectiles', () => {
    const ctx = bareCtx();
    const spec = {
      kind: 'arrow' as const, owner: 1, sourceId: 5, sourceType: 'archer', targetId: 6,
      from: { x: 1, y: 1 }, to: { x: 4, y: 5 }, flightTicks: 3, damage: 5,
    };
    spawnProjectile(ctx, spec);
    spawnProjectile(ctx, { ...spec, flightTicks: 1 });
    expect(ctx.state.projectiles.map((p) => [p.id, p.ticksLeft])).toEqual([[1, 3], [2, 1]]);
    expect(ctx.state.nextProjectileId).toBe(3);
    spec.from.x = 99;
    expect(ctx.state.projectiles[0]!.from.x).toBe(1);
  });

  it('in a running sim, projectiles disappear after their flight ticks', () => {
    const { sim } = buildV2Fixture();
    expect(sim.state.projectiles.map((p) => p.ticksLeft)).toEqual([3, 6]);
    for (let i = 0; i < 3; i++) sim.step([]);
    expect(sim.state.projectiles.map((p) => p.id)).toEqual([2]);
    for (let i = 0; i < 3; i++) sim.step([]);
    expect(sim.state.projectiles).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

describe('GameConfig defaults (PLAN-M2 2.6, 3.5)', () => {
  it('two players: conquest, slot colours, names, controllers, conquest objectives', () => {
    const s = createGame(TWO).state;
    expect(s.match).toEqual({ mode: 'conquest', winner: null, endedTick: null });
    expect(s.players.map((p) => [p.name, p.controller, p.difficulty, p.outcome])).toEqual([
      ['Neutral', 'neutral', null, 'playing'],
      ['Player', 'human', null, 'playing'],
      ['Player 2', 'human', null, 'playing'],
    ]);
    expect(s.players[1]!.color).toBe(PLAYER_COLORS[0]!.value);
    expect(s.players[2]!.color).toBe(PLAYER_COLORS[1]!.value);
    expect(s.objectives.entries).toEqual([
      { id: 'conquest:1', kind: 'conquest', playerId: 1, targetAge: null, completedTick: null },
      { id: 'conquest:2', kind: 'conquest', playerId: 2, targetAge: null, completedTick: null },
    ]);
    expect(s.projectiles).toEqual([]);
    expect(s.nextProjectileId).toBe(1);
  });

  it('an AI slot, explicit colours and names, and the sandbox default for one player', () => {
    const s = createGame({ ...TWO, players: [{ civ: 'byzantines', color: 0xc62f2f }, { civ: 'byzantines', difficulty: 'hard', color: 0x2f6bd8 }] }).state;
    expect([s.players[1]!.color, s.players[2]!.color]).toEqual([0xc62f2f, 0x2f6bd8]);
    expect(s.players[2]).toMatchObject({ name: 'Computer (Hard)', controller: 'ai', difficulty: 'hard' });
    const named = createGame({ ...TWO, players: [{ civ: 'byzantines', name: 'Anna' }, { civ: 'byzantines', controller: 'ai' }] }).state;
    expect(named.players[1]!.name).toBe('Anna');
    expect(named.players[2]).toMatchObject({ name: 'Computer (Standard)', controller: 'ai', difficulty: 'standard' });
    const one = createGame({ seed: 9, mapSize: 120, players: [{ civ: 'byzantines' }] }).state;
    expect(one.match.mode).toBe('sandbox');
    expect(one.objectives.entries).toEqual([{ id: 'reachEmpireAge:1', kind: 'reachAge', playerId: 1, targetAge: 4, completedTick: null }]);
    expect(createGame({ ...TWO, mode: 'sandbox' }).state.objectives.entries[0]!.kind).toBe('reachAge');
  });

  it('players start with empty stats and age 1 reached at tick 0', () => {
    const p = createGame(TWO).state.players[1]!;
    expect(p.stats).toEqual({
      unitsTrained: 0, unitsLost: 0, unitsKilled: 0, buildingsBuilt: 0, buildingsLost: 0, buildingsDestroyed: 0,
      resourcesGathered: { food: 0, wood: 0, gold: 0, stone: 0 }, techsResearched: 0, peakPopulation: 6,
      ageReachedTick: [0, null, null, null],
    });
    expect(p.alert).toBeNull();
    expect(p.defeatedTick).toBeNull();
  });
});

describe('entity creation defaults (PLAN-M2 3.5) and construction hp (4.11)', () => {
  it('units: full hp, aggressive, ready, first scan staggered by id', () => {
    for (const u of createGame(TWO).state.entities) {
      if (u.kind !== 'unit') continue;
      expect(u).toMatchObject({ hp: 25, stance: 'aggressive', lastAttackerId: null, lastDamagedTick: null });
      expect(u.combat).toEqual({ cooldown: 0, windup: 0, swingTargetId: null, nextScanTick: u.id % ACQUIRE_INTERVAL_TICKS, lastAttackTick: null });
    }
  });

  it('the starting Town Centers are at max hp with an attack state; other buildings have none', () => {
    const tcs = createGame(TWO).state.entities.filter((e) => e.kind === 'building') as BuildingEntity[];
    expect(tcs).toHaveLength(2);
    for (const tc of tcs) {
      expect(tc).toMatchObject({ hp: 2400, builtHp: 2400, repairerIds: [], repairAccumulator: 0 });
      expect(tc.attack).toEqual({ cooldown: 0, targetId: null, nextScanTick: tc.id % ACQUIRE_INTERVAL_TICKS, lastAttackTick: null });
    }
    const ctx = bareCtx();
    expect(createBuilding(ctx.state, 'house', 1, 5, 5, true).attack).toBeNull();
  });

  it('a foundation starts at 10% hp and reaches max hp when finished; damage taken while building is kept', () => {
    const d = new Driver({ seed: 3, mapSize: 120, players: [{ civ: 'byzantines' }] });
    const tc = d.sim.state.entities.find((e) => e.kind === 'building') as BuildingEntity;
    const builders = d.units(1).slice(0, 2).map((u) => u.id);
    let spot: { tx: number; ty: number } | null = null;
    for (let r = 3; r < 12 && spot === null; r++) {
      for (const [dx, dy] of [[r, 0], [0, r], [-r, 0], [0, -r]] as const) {
        if (spot === null && d.sim.query.canPlace(1, 'house', tc.tile.tx + dx, tc.tile.ty + dy).ok) spot = { tx: tc.tile.tx + dx, ty: tc.tile.ty + dy };
      }
    }
    expect(spot).not.toBeNull();
    d.step([{ type: 'build', unitIds: builders, buildingType: 'house', tx: spot!.tx, ty: spot!.ty, queue: false }]);
    const house = () => d.sim.state.entities.find((e) => e.kind === 'building' && e.typeId === 'house') as BuildingEntity;
    expect(house()).toMatchObject({ hp: 55, builtHp: 55, constructed: false });
    for (let i = 0; i < 2000 && !house().constructed; i++) {
      d.step();
      const h = house();
      expect(h.hp).toBe(h.builtHp);
      expect(h.builtHp).toBe(h.constructed ? 550 : Math.max(1, Math.floor((550 * (10 + 90 * h.progress)) / 100)));
    }
    expect(house()).toMatchObject({ constructed: true, hp: 550, builtHp: 550 });
    expect(d.sim.state.players[1]!.stats.buildingsBuilt).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

describe('command intake (PLAN-M2 3.4)', () => {
  it('validates the shapes of the new commands and cheats', () => {
    const d = new Driver();
    const id = d.units(1)[0]!.id;
    const bad: CommandInput[] = [
      { type: 'attack', unitIds: [id], targetId: 0, queue: false },
      { type: 'attack', unitIds: [], targetId: 5, queue: false },
      { type: 'attackMove', unitIds: [id], x: Number.NaN, y: 1, queue: false },
      { type: 'setStance', unitIds: [id], stance: 'berserk' as never },
      { type: 'repair', unitIds: [id], buildingId: 3, queue: 'yes' as never },
      { type: 'hold', unitIds: [] },
      { type: 'cheat', cheat: { kind: 'setHp', entityId: id, hp: Number.POSITIVE_INFINITY } },
      { type: 'cheat', cheat: { kind: 'defeat', playerId: 3 } },
      { type: 'cheat', cheat: { kind: 'defeat', playerId: 0 } },
      { type: 'cheat', cheat: { kind: 'spawnUnit', unitType: 'spearman', x: 5, y: 5, owner: 1.5 } },
    ];
    for (const c of bad) expect(d.rejections(d.step([c])), JSON.stringify(c)).toEqual(['invalidCommand']);
  });

  it('the combat command handlers are stubs that reject (until WP21/WP23/WP24 land)', () => {
    const d = new Driver();
    const id = d.units(1)[0]!.id;
    const enemy = d.units(2)[0]!.id;
    const stubbed: CommandInput[] = [
      { type: 'attack', unitIds: [id], targetId: enemy, queue: false },
      { type: 'attackMove', unitIds: [id], x: 30, y: 30, queue: false },
      { type: 'hold', unitIds: [id] },
      { type: 'setStance', unitIds: [id], stance: 'standGround' },
      { type: 'repair', unitIds: [id], buildingId: 1, queue: false },
      { type: 'resign' },
    ];
    for (const c of stubbed) expect(d.rejections(d.step([c])), c.type).toEqual(['invalidCommand']);
  });

  it('rejects everything but cheats from a defeated player; the winner keeps playing', () => {
    const d = new Driver();
    const mine = d.units(1).map((u) => u.id);
    const events = d.step([{ type: 'cheat', cheat: { kind: 'defeat', playerId: 1 } }]);
    expect(events).toContainEqual({ type: 'PlayerDefeated', playerId: 1, reason: 'conquered' });
    expect(d.sim.state.players[1]).toMatchObject({ outcome: 'defeated', defeatedTick: 1 });
    expect(d.rejections(d.step([{ type: 'move', unitIds: mine, x: 30, y: 30, queue: false }]))).toEqual(['playerDefeated']);
    expect(d.rejections(d.step([{ type: 'cheat', cheat: { kind: 'addResources', amounts: { wood: 5 } } }]))).toEqual([]);
    expect(d.rejections(d.step([{ type: 'cheat', cheat: { kind: 'defeat', playerId: 1 } }]))).toEqual(['invalidTarget']);
    (d.sim.state.players[2] as { outcome: string }).outcome = 'won';
    const theirs = d.units(2).map((u) => u.id);
    expect(d.rejections(d.step([{ type: 'move', unitIds: theirs, x: 30, y: 30, queue: false }], 2))).toEqual([]);
  });

  it('spawnUnit with an owner, setHp clamped to 0..max', () => {
    const d = new Driver();
    const tc = d.sim.state.entities.find((e) => e.kind === 'building' && e.owner === 1) as BuildingEntity;
    const x = tc.tile.tx - 2.5;
    const y = tc.tile.ty - 2.5;
    expect(d.rejections(d.step([{ type: 'cheat', cheat: { kind: 'spawnUnit', unitType: 'horseman', x, y, owner: 2 } }]))).toEqual([]);
    const horse = d.units(2).find((u) => u.typeId === 'horseman')!;
    expect(horse).toMatchObject({ hp: 70, owner: 2 });
    d.step([{ type: 'cheat', cheat: { kind: 'setHp', entityId: horse.id, hp: 12.4 } }]);
    expect(horse.hp).toBe(12);
    d.step([{ type: 'cheat', cheat: { kind: 'setHp', entityId: horse.id, hp: 999 } }]);
    expect(horse.hp).toBe(70);
    d.step([{ type: 'cheat', cheat: { kind: 'setHp', entityId: tc.id, hp: -5 } }]);
    expect(tc.hp).toBe(0);
    const node = d.sim.state.entities.find((e) => e.kind === 'node')!;
    expect(d.rejections(d.step([{ type: 'cheat', cheat: { kind: 'setHp', entityId: node.id, hp: 1 } }]))).toEqual(['invalidTarget']);
    expect(d.rejections(d.step([{ type: 'cheat', cheat: { kind: 'setHp', entityId: 99999, hp: 1 } }]))).toEqual(['unknownEntity']);
  });
});

// ---------------------------------------------------------------------------
// Stats through the existing systems
// ---------------------------------------------------------------------------

describe('recordStat calls in the M1 systems', () => {
  it('counts training, construction, gathering, research, ages and peak population (economy bot, 7 minutes)', () => {
    const sim = createGame({ seed: 1, mapSize: 120, players: [{ civ: 'byzantines' }] });
    const bot = new EconomyBot(1);
    let trained = 0;
    let completed = 0;
    let researched = 0;
    let ageTick: number | null = null;
    for (let t = 0; t < 7 * 60 * 20; t++) {
      for (const e of sim.step(bot.update(sim))) {
        if (e.type === 'UnitTrained') trained++;
        if (e.type === 'BuildingCompleted') completed++;
        if (e.type === 'ResearchCompleted') researched++;
        if (e.type === 'AgeAdvanced' && e.age === 2) ageTick = sim.state.tick;
      }
    }
    const p = sim.state.players[1]!;
    expect(trained).toBeGreaterThan(5);
    expect(p.stats.unitsTrained).toBe(trained);
    expect(p.stats.buildingsBuilt).toBe(completed);
    expect(p.stats.techsResearched).toBe(researched);
    expect(ageTick).not.toBeNull();
    expect(p.stats.ageReachedTick).toEqual([0, ageTick, null, null]);
    expect(p.stats.peakPopulation).toBeGreaterThanOrEqual(p.popUsed);
    const g = p.stats.resourcesGathered;
    expect(g.food + g.wood + g.gold + g.stone).toBeGreaterThan(1000);
    for (const v of Object.values(g)) expect(Number.isInteger(v)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Determinism with the combat stubs
// ---------------------------------------------------------------------------

describe('a 2-player match with the combat stubs', () => {
  function run(): string[] {
    const sim = createGame(TWO);
    const bots = [new EconomyBot(1), new EconomyBot(2)];
    const hashes: string[] = [];
    for (let t = 0; t < 1000; t++) {
      const cmds: Command[] = [];
      for (const b of bots) cmds.push(...b.update(sim));
      const events = sim.step(cmds);
      for (const e of events) expect(['UnitDied', 'BuildingDestroyed', 'UnderAttack', 'MatchEnded']).not.toContain(e.type);
      if (t % 100 === 99) hashes.push(hashState(sim.state));
    }
    expect(sim.state.match.winner).toBeNull();
    return hashes;
  }

  it('runs 1,000 ticks with two economy bots, identically twice', () => {
    const a = run();
    expect(run()).toEqual(a);
  });

  it('a stub AiPlayer issues nothing and saves its memory beside the state', () => {
    const sim = createGame({ ...TWO, players: [{ civ: 'byzantines' }, { civ: 'byzantines', difficulty: 'easy' }] });
    const ai = AiPlayer.create(2, 'easy', 9);
    expect(ai.update(sim)).toEqual([]);
    const loaded = deserializeSave(serialize(sim, [ai.save()]));
    expect(loaded.controllers).toEqual([{ playerId: 2, kind: 'ai', difficulty: 'easy', memory: {} }]);
    expect(AiPlayer.restore(loaded.controllers[0]!).save()).toEqual(ai.save());
  });
});

// ---------------------------------------------------------------------------
// Save v2
// ---------------------------------------------------------------------------

describe('save v2 (PLAN-M2 2.8, 3.6)', () => {
  it.runIf(UPDATE)('regenerates save-v1-as-v2.json and save-v2.json', () => {
    writeFileSync(V1_AS_V2, serialize(deserialize(readFileSync(V1, 'utf8').trim())) + '\n');
    const { sim, controllers } = buildV2Fixture();
    writeFileSync(V2, serialize(sim, controllers) + '\n');
  });

  it('the v1 fixture migrates to exactly save-v1-as-v2.json', () => {
    const loaded = deserializeSave(readFileSync(V1, 'utf8').trim());
    expect(loaded.controllers).toEqual([]);
    expect(serialize(loaded.sim, loaded.controllers)).toBe(readFileSync(V1_AS_V2, 'utf8').trim());
  });

  it('migrated v1 states are sandbox matches with full-hp units and construction hp on foundations', () => {
    const s = deserialize(readFileSync(V1, 'utf8').trim()).state;
    expect(s.match).toEqual({ mode: 'sandbox', winner: null, endedTick: null });
    expect(s.projectiles).toEqual([]);
    expect(s.players.map((p) => [p.name, p.controller])).toEqual([['Neutral', 'neutral'], ['Player', 'human']]);
    expect(s.players[1]!.stats.peakPopulation).toBe(s.players[1]!.popUsed);
    for (const e of s.entities) {
      if (e.kind === 'unit') {
        expect(e.hp).toBe(registry.unit(e.typeId).combat.hp);
        expect(e.combat.nextScanTick).toBe(s.tick + (e.id % 10));
      } else if (e.kind === 'building') {
        const max = registry.building(e.typeId).combat.hp;
        expect(e.hp).toBe(e.constructed ? max : Math.max(1, Math.floor((max * (10 + 90 * e.progress)) / 100)));
        expect(e.attack === null).toBe(e.typeId !== 'townCenter');
      }
    }
    // The fixture's house is finished; an unfinished one gets the construction-hp formula.
    const file = JSON.parse(readFileSync(V1, 'utf8')) as { state: { entities: Record<string, unknown>[] } };
    const house = file.state.entities.find((e) => e.typeId === 'house')!;
    Object.assign(house, { constructed: false, progress: 0.5 });
    const migrated = deserialize(JSON.stringify(file)).state.entities.find((e) => e.id === house.id) as BuildingEntity;
    expect(migrated).toMatchObject({ hp: Math.floor((550 * (10 + 45)) / 100), builtHp: 302 });
  });

  it('the v2 fixture is what the builder makes, round-trips byte for byte, and keeps its controllers', () => {
    const text = readFileSync(V2, 'utf8').trim();
    const built = buildV2Fixture();
    expect(serialize(built.sim, built.controllers)).toBe(text);
    const file = JSON.parse(text) as { version: number; state: { map: { width: number }; match: { mode: string } } };
    expect(file.version).toBe(SAVE_VERSION);
    expect(file.state.map.width).toBe(48);
    expect(file.state.match.mode).toBe('conquest');
    const loaded = deserializeSave(text);
    expect(serialize(loaded.sim, loaded.controllers)).toBe(text);
    expect(loaded.controllers).toEqual(built.controllers);
    const s = loaded.sim.state;
    expect(s.projectiles.length).toBe(2);
    expect(s.entities.some((e) => e.kind === 'unit' && e.hp === 0)).toBe(true);
    expect(s.entities.some((e) => e.kind === 'building' && e.repairerIds.length > 0 && e.hp < 1200)).toBe(true);
  });

  it('200 continued ticks of the loaded fixture equal the uninterrupted run', () => {
    const loaded = deserialize(readFileSync(V2, 'utf8').trim());
    const { sim } = buildV2Fixture();
    for (let i = 0; i < 200; i++) {
      loaded.step([]);
      sim.step([]);
      if (i % 20 === 19) expect(hashState(loaded.state)).toBe(hashState(sim.state));
    }
    expect(serialize(loaded)).toBe(serialize(sim));
  });

  it('refuses damaged v2 files with "corrupt" and a message', () => {
    const text = readFileSync(V2, 'utf8').trim();
    type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const damage = (edit: (f: J) => void): string => {
      const file = JSON.parse(text) as J;
      edit(file);
      try {
        deserializeSave(JSON.stringify(file));
      } catch (e) {
        expect(e).toBeInstanceOf(SaveError);
        expect((e as SaveError).code).toBe('corrupt');
        return (e as SaveError).message;
      }
      return 'loaded';
    };
    const unit = (f: J): J => f.state.entities.find((e: J) => e.kind === 'unit');
    const building = (f: J): J => f.state.entities.find((e: J) => e.kind === 'building');
    expect(damage(() => {})).toBe('loaded');
    expect(damage((f) => { unit(f).hp = 1.5; })).toMatch(/hit points/);
    expect(damage((f) => { unit(f).hp = 9999; })).toMatch(/more hit points/);
    expect(damage((f) => { unit(f).stance = 'berserk'; })).toMatch(/stance/);
    expect(damage((f) => { unit(f).combat.windup = -1; })).toMatch(/combat state/);
    expect(damage((f) => { building(f).repairerIds = [building(f).id]; })).toMatch(/repairer/);
    expect(damage((f) => { building(f).attack = null; })).toMatch(/attack state/);
    expect(damage((f) => { f.state.projectiles[1].id = 1; })).toMatch(/projectile ids/);
    expect(damage((f) => { f.state.projectiles[0].id = f.state.nextProjectileId; })).toMatch(/projectile ids/);
    expect(damage((f) => { f.state.projectiles[0].ticksLeft = 0.5; })).toMatch(/flight time/);
    expect(damage((f) => { f.state.projectiles[0].to = { x: null, y: 1 }; })).toMatch(/position/);
    expect(damage((f) => { f.state.match.winner = 7; })).toMatch(/winner/);
    expect(damage((f) => { f.state.match.mode = 'chess'; })).toMatch(/mode/);
    expect(damage((f) => { f.state.players[1].outcome = 'bored'; })).toMatch(/outcome/);
    expect(damage((f) => { delete f.state.players[1].stats; })).toMatch(/statistics/);
    expect(damage((f) => { f.state.objectives.entries[0].targetAge = 4; })).toMatch(/objective/);
    expect(damage((f) => { delete f.controllers; })).toMatch(/controller/);
    expect(damage((f) => { f.controllers[0].playerId = 9; })).toMatch(/controller/);
    expect(damage((f) => { f.controllers[0].kind = 'human'; })).toMatch(/controller/);
  });
});
