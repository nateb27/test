/**
 * WP22: projectiles (PLAN-M2 2.4, 4.4) and Town Center arrows (4.10). Systems are driven directly on hand-built
 * states; the determinism tests go through `sim.step`.
 */

import { describe, expect, it } from 'vitest';
import { registry } from '../../src/data';
import { createBuilding, createUnit } from '../../src/sim/entities';
import { hashState } from '../../src/sim/hash';
import { rebuildRuntime } from '../../src/sim/runtime';
import { deserialize, serialize } from '../../src/sim/serialize';
import { createInitialState, simFromState } from '../../src/sim/sim';
import { ACQUIRE_BUDGET_PER_TICK, type GameConfig, type GameState, type SimContext } from '../../src/sim/types';
import { computeDamage, unitCombat } from '../../src/sim/systems/combat/damage';
import { runBuildingAttacks } from '../../src/sim/systems/defence';
import { projectileFlightTicks, runProjectiles, spawnProjectile } from '../../src/sim/systems/projectiles';

const CONFIG: GameConfig = {
  seed: 7,
  mapSize: 48,
  players: [{ civ: 'byzantines' }, { civ: 'byzantines', difficulty: 'standard' }],
};

function world(): SimContext {
  const state = createInitialState(CONFIG, registry);
  return { state, runtime: rebuildRuntime(state, registry), data: registry, events: [] };
}

/** One tick of steps 8b and 9 (the ones this package owns). */
function tick(ctx: SimContext): void {
  ctx.runtime.acquireBudget = ACQUIRE_BUDGET_PER_TICK;
  runBuildingAttacks(ctx);
  runProjectiles(ctx);
  ctx.state.tick += 1;
}

function arrowAt(ctx: SimContext, target: { id: number }, damage = 5, flightTicks = 4, owner = 1, sourceId = 9999): void {
  spawnProjectile(ctx, {
    kind: 'arrow',
    owner,
    sourceId,
    sourceType: 'archer',
    targetId: target.id,
    from: { x: 0, y: 0 },
    to: { x: 0, y: 0 },
    flightTicks,
    damage,
  });
}

describe('WP22 projectile flight', () => {
  it('flightTicks = max(1, ceil(dist * 20 / speed)) with the data speeds', () => {
    const ctx = world();
    expect(projectileFlightTicks(ctx, 'arrow', 9)).toBe(20);
    expect(projectileFlightTicks(ctx, 'arrow', 4.5)).toBe(10);
    expect(projectileFlightTicks(ctx, 'arrow', 4.6)).toBe(11);
    expect(projectileFlightTicks(ctx, 'arrow', 0)).toBe(1);
    expect(projectileFlightTicks(ctx, 'arrow', 0.01)).toBe(1);
    expect(projectileFlightTicks(ctx, 'stone', 1)).toBe(4);
    expect(projectileFlightTicks(ctx, 'fire', 8)).toBe(20);
  });

  it('homes on a moving target and hits on the last tick', () => {
    const ctx = world();
    const target = createUnit(ctx.state, 'spearman', 2, 10.5, 10.5);
    const hp0 = target.hp;
    arrowAt(ctx, target, 7, 4);
    for (let i = 0; i < 3; i++) {
      target.pos.x += 1;
      runProjectiles(ctx);
      expect(ctx.state.projectiles).toHaveLength(1);
      expect(ctx.state.projectiles[0]!.to).toEqual({ x: target.pos.x, y: target.pos.y });
      expect(target.hp).toBe(hp0);
    }
    target.pos.y += 2;
    runProjectiles(ctx);
    expect(ctx.state.projectiles).toHaveLength(0);
    expect(target.hp).toBe(hp0 - 7);
    expect(target.lastAttackerId).toBe(9999);
  });

  it('a projectile that is fired with one tick of flight lands in the same step 9', () => {
    const ctx = world();
    const target = createUnit(ctx.state, 'spearman', 2, 10.5, 10.5);
    arrowAt(ctx, target, 3, 1);
    runProjectiles(ctx);
    expect(ctx.state.projectiles).toHaveLength(0);
    expect(target.hp).toBe(unitCombat(ctx, 2, 'spearman').maxHp - 3);
  });

  it('wastes the arrow when the target is gone or already at 0 hp', () => {
    const ctx = world();
    const gone = createUnit(ctx.state, 'spearman', 2, 10.5, 10.5);
    const dead = createUnit(ctx.state, 'spearman', 2, 12.5, 10.5);
    dead.hp = 0;
    const dummy = createUnit(ctx.state, 'spearman', 2, 14.5, 10.5);
    arrowAt(ctx, gone, 5, 3);
    arrowAt(ctx, dead, 5, 3);
    ctx.state.entities = ctx.state.entities.filter((e) => e.id !== gone.id);
    for (let i = 0; i < 3; i++) runProjectiles(ctx);
    expect(ctx.state.projectiles).toHaveLength(0);
    expect(dead.hp).toBe(0);
    expect(dead.lastAttackerId).toBeNull();
    expect(dummy.hp).toBe(unitCombat(ctx, 2, 'spearman').maxHp);
    expect(ctx.events).toHaveLength(0);
  });

  it('does not hurt a friendly or neutral target', () => {
    const ctx = world();
    const friend = createUnit(ctx.state, 'spearman', 1, 10.5, 10.5);
    arrowAt(ctx, friend, 5, 1, 1);
    runProjectiles(ctx);
    expect(friend.hp).toBe(unitCombat(ctx, 1, 'spearman').maxHp);
  });

  it('credits the kill to a shooter that has died', () => {
    const ctx = world();
    const target = createUnit(ctx.state, 'spearman', 2, 10.5, 10.5);
    target.hp = 3;
    arrowAt(ctx, target, 20, 2, 1, 424242); // no entity 424242 exists
    runProjectiles(ctx);
    runProjectiles(ctx);
    expect(target.hp).toBe(0);
    expect(target.lastAttackerId).toBe(424242);
    expect(ctx.state.projectiles).toHaveLength(0);
  });
});

describe('WP22 fire splash', () => {
  /** Builds the same scene with the creation order of the victims permuted. */
  function splashScene(order: readonly number[]): { ctx: SimContext; hp: Record<string, number>; primaryId: number } {
    const ctx = world();
    const spots: Record<string, [string, number, number, number]> = {
      primary: ['spearman', 2, 20.5, 20.5],
      nearEnemy: ['archer', 2, 21.2, 20.5],
      edgeEnemy: ['villager', 2, 20.5, 19.6],
      farEnemy: ['spearman', 2, 22.0, 20.5],
      friend: ['spearman', 1, 20.5, 21.0],
    };
    const names = ['primary', 'nearEnemy', 'edgeEnemy', 'farEnemy', 'friend'];
    const ids: Record<string, number> = {};
    for (const i of order) {
      const name = names[i]!;
      const [type, owner, x, y] = spots[name]!;
      ids[name] = createUnit(ctx.state, type, owner, x, y).id;
    }
    createBuilding(ctx.state, 'house', 2, 21, 18, true); // footprint [21,23]x[18,20]: within 1.0 of (20.5, 20.5)? nearest point (21, 20)
    spawnProjectile(ctx, {
      kind: 'fire',
      owner: 1,
      sourceId: 7777,
      sourceType: 'siphonarios',
      targetId: ids['primary']!,
      from: { x: 15, y: 20 },
      to: { x: 20.5, y: 20.5 },
      flightTicks: 2,
      damage: 10,
    });
    runProjectiles(ctx);
    runProjectiles(ctx);
    const hp: Record<string, number> = {};
    for (const [name, id] of Object.entries(ids)) {
      const u = ctx.state.entities.find((e) => e.id === id);
      hp[name] = u !== undefined && u.kind === 'unit' ? u.hp : -1;
    }
    const house = ctx.state.entities.find((e) => e.kind === 'building');
    hp['house'] = house !== undefined && house.kind === 'building' ? house.hp : -1;
    return { ctx, hp, primaryId: ids['primary']! };
  }

  it('hits enemies within the radius, excludes the primary, never hurts friends, and covers buildings', () => {
    const ctx0 = world();
    const { ctx, hp } = splashScene([0, 1, 2, 3, 4]);
    const full = (type: string, owner: number): number => unitCombat(ctx0, owner, type).maxHp;
    // Primary: direct damage only (10), no splash on top.
    expect(hp['primary']).toBe(full('spearman', 2) - 10);
    // Enemies within 1.0 of the impact point take splash; the one at 1.5 and the friend do not.
    const src = unitCombat(ctx0, 1, 'siphonarios');
    expect(src.splash).not.toBeNull();
    const pct = src.splash!.percent;
    const dmgVs = (type: string, owner: number): number => {
      const def = unitCombat(ctx0, owner, type);
      return Math.max(1, Math.floor((computeDamage(src, def, 1) * pct) / 100));
    };
    expect(hp['nearEnemy']).toBe(full('archer', 2) - dmgVs('archer', 2));
    expect(hp['edgeEnemy']).toBe(full('villager', 2) - dmgVs('villager', 2));
    expect(hp['farEnemy']).toBe(full('spearman', 2));
    expect(hp['friend']).toBe(full('spearman', 1));
    expect(hp['house']).toBeLessThan(ctx.data.building('house').combat.hp);
    expect(ctx.state.projectiles).toHaveLength(0);
  });

  it('splashes even when the primary target is gone, and is independent of creation order', () => {
    const a = splashScene([0, 1, 2, 3, 4]);
    const b = splashScene([4, 3, 2, 1, 0]);
    expect(b.hp).toEqual(a.hp);
    // Primary removed before impact: the same victims still take splash.
    const ctx = world();
    const prim = createUnit(ctx.state, 'spearman', 2, 20.5, 20.5);
    const near = createUnit(ctx.state, 'spearman', 2, 21.0, 20.5);
    spawnProjectile(ctx, {
      kind: 'fire', owner: 1, sourceId: 7777, sourceType: 'siphonarios', targetId: prim.id,
      from: { x: 15, y: 20 }, to: { x: 20.5, y: 20.5 }, flightTicks: 2, damage: 10,
    });
    runProjectiles(ctx);
    ctx.state.entities = ctx.state.entities.filter((e) => e.id !== prim.id);
    runProjectiles(ctx);
    expect(near.hp).toBeLessThan(unitCombat(ctx, 2, 'spearman').maxHp);
  });

  it('arrows and stones never splash', () => {
    const ctx = world();
    const prim = createUnit(ctx.state, 'spearman', 2, 20.5, 20.5);
    const near = createUnit(ctx.state, 'spearman', 2, 20.8, 20.5);
    arrowAt(ctx, prim, 5, 1);
    runProjectiles(ctx);
    expect(near.hp).toBe(unitCombat(ctx, 2, 'spearman').maxHp);
  });
});

describe('WP22 Town Center arrows', () => {
  // Town Center footprint 4 at (10,10): centre (12,12).
  function tcWorld(constructed = true): { ctx: SimContext; tc: ReturnType<typeof createBuilding> } {
    const ctx = world();
    ctx.state.tick = 100;
    const tc = createBuilding(ctx.state, 'townCenter', 1, 10, 10, constructed);
    if (tc.attack !== null) tc.attack.nextScanTick = 100;
    return { ctx, tc };
  }

  it('fires 2 arrows every 40 ticks at the nearest fighting unit', () => {
    const { ctx, tc } = tcWorld();
    // A closer villager (tier 2), a nearer-than-other soldier (tier 1) and a far soldier.
    const villager = createUnit(ctx.state, 'villager', 2, 14.0, 12.0);
    const near = createUnit(ctx.state, 'spearman', 2, 16.0, 12.0);
    createUnit(ctx.state, 'spearman', 2, 17.5, 12.0);
    const fireTicks: number[] = [];
    for (let i = 0; i < 130; i++) {
      const before = ctx.state.nextProjectileId;
      tick(ctx);
      if (ctx.state.nextProjectileId > before) {
        fireTicks.push(ctx.state.tick - 1);
        expect(ctx.state.nextProjectileId - before).toBe(2);
        const fired = ctx.state.projectiles.filter((p) => p.id >= before);
        expect(fired.every((p) => p.targetId === near.id && p.kind === 'arrow' && p.sourceId === tc.id)).toBe(true);
        expect(fired[0]!.from).toEqual({ x: 12, y: 12 });
        expect(fired[0]!.flightTicks).toBe(projectileFlightTicks(ctx, 'arrow', 4));
      }
      // Keep the targets alive so only the schedule is measured.
      near.hp = unitCombat(ctx, 2, 'spearman').maxHp;
    }
    expect(fireTicks).toEqual([100, 140, 180, 220].filter((t) => t < 230));
    expect(villager.hp).toBe(unitCombat(ctx, 2, 'villager').maxHp);
  });

  it('arrow damage is the 4.1 formula against the target', () => {
    const { ctx } = tcWorld();
    const target = createUnit(ctx.state, 'spearman', 2, 15.0, 12.0);
    tick(ctx);
    const p = ctx.state.projectiles[0]!;
    const att = { attack: 5, attackType: 'pierce' as const, bonus: {} };
    expect(p.damage).toBe(computeDamage(att, unitCombat(ctx, 2, 'spearman'), 1));
    expect(p.targetId).toBe(target.id);
  });

  it('targets a villager when no fighting unit is in reach, ignores buildings and out-of-reach units', () => {
    const { ctx } = tcWorld();
    createBuilding(ctx.state, 'house', 2, 15, 10, true);
    createUnit(ctx.state, 'spearman', 2, 21.0, 12.0); // 9 tiles: outside reach 7.75
    const v = createUnit(ctx.state, 'villager', 2, 17.0, 12.0);
    tick(ctx);
    expect(ctx.state.projectiles.every((p) => p.targetId === v.id)).toBe(true);
    expect(ctx.state.projectiles).toHaveLength(2);
  });

  it('does not fire at buildings, friends, or with nothing around', () => {
    const { ctx } = tcWorld();
    createBuilding(ctx.state, 'house', 2, 15, 10, true);
    createUnit(ctx.state, 'spearman', 1, 14.0, 12.0);
    for (let i = 0; i < 30; i++) tick(ctx);
    expect(ctx.state.nextProjectileId).toBe(1);
  });

  it('an unfinished Town Center does not fire; a completed one does even at low hp', () => {
    const a = tcWorld(false);
    createUnit(a.ctx.state, 'spearman', 2, 15.0, 12.0);
    for (let i = 0; i < 30; i++) tick(a.ctx);
    expect(a.ctx.state.nextProjectileId).toBe(1);
    const b = tcWorld(true);
    b.tc.hp = 1;
    createUnit(b.ctx.state, 'spearman', 2, 15.0, 12.0);
    tick(b.ctx);
    expect(b.ctx.state.projectiles).toHaveLength(2);
  });

  it('keeps its target while it stays in reach and drops it when it leaves', () => {
    const { ctx, tc } = tcWorld();
    const a = createUnit(ctx.state, 'spearman', 2, 16.0, 12.0);
    tick(ctx);
    expect(tc.attack!.targetId).toBe(a.id);
    createUnit(ctx.state, 'spearman', 2, 14.0, 12.0); // closer newcomer
    for (let i = 0; i < 12; i++) tick(ctx);
    expect(tc.attack!.targetId).toBe(a.id);
    a.pos.x = 30;
    tick(ctx);
    expect(tc.attack!.targetId).not.toBe(a.id); // a due scan picks the newcomer
  });
});

describe('WP22 determinism', () => {
  function scenario(): GameState {
    const state = createInitialState(CONFIG, registry);
    createBuilding(state, 'townCenter', 1, 10, 10, true);
    createBuilding(state, 'townCenter', 2, 30, 30, true);
    for (let i = 0; i < 6; i++) createUnit(state, i % 2 === 0 ? 'spearman' : 'villager', 2, 15.5 + i * 0.7, 12.0 + (i % 3));
    for (let i = 0; i < 4; i++) createUnit(state, 'archer', 1, 26.5 + i * 0.5, 28.0);
    const u = createUnit(state, 'spearman', 2, 12.5, 16.5);
    spawnProjectile(
      { state, runtime: rebuildRuntime(state, registry), data: registry, events: [] },
      { kind: 'fire', owner: 1, sourceId: 5, sourceType: 'siphonarios', targetId: u.id, from: { x: 5, y: 5 }, to: { x: 12.5, y: 16.5 }, flightTicks: 30, damage: 12 },
    );
    return state;
  }

  function run(state: GameState, ticks: number): ReturnType<typeof simFromState> {
    const sim = simFromState(state);
    for (let i = 0; i < ticks; i++) sim.step([]);
    return sim;
  }

  it('same scenario twice gives the same hash, with projectiles in flight', () => {
    const a = run(scenario(), 12);
    const b = run(scenario(), 12);
    expect(a.state.projectiles.length).toBeGreaterThan(0);
    expect(hashState(a.state)).toBe(hashState(b.state));
  });

  it('save/load with projectiles in flight equals the uninterrupted run', () => {
    const uninterrupted = run(scenario(), 60);
    const half = run(scenario(), 12);
    expect(half.state.projectiles.length).toBeGreaterThan(0);
    const loaded = deserialize(serialize(half));
    for (let i = 0; i < 48; i++) loaded.step([]);
    expect(hashState(loaded.state)).toBe(hashState(uninterrupted.state));
    expect(serialize(loaded)).toBe(serialize(uninterrupted));
  });
});
