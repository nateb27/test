/**
 * WP21 combat core (PLAN-M2 4.2, 4.3, 4.5, 4.6, 4.8; tests of 8.1): timing, simultaneity, acquisition, chasing,
 * stances, the combat commands, and determinism of a scripted melee and ranged skirmish. Hand-built states on an
 * empty map, stepped through the real tick order. Since Phase 2 integration the real projectile flight (WP22) and
 * death step (WP23) run too: a unit at 0 hp is removed in step 11 of the same tick (`hpOf` reads a removed unit as 0).
 */

import { describe, expect, it } from 'vitest';
import { registry } from '../../src/data/index';
import { createNode, findEntity } from '../../src/sim/entities';
import { hashState } from '../../src/sim/hash';
import { deserialize, serialize } from '../../src/sim/serialize';
import { applyDamage, computeDamage, unitCombat } from '../../src/sim/systems/combat/damage';
import { scanForTarget } from '../../src/sim/systems/combat/acquire';
import { rebuildSpatialIndex, visitBuildingsNear, visitUnitsNear } from '../../src/sim/systems/combat/spatial';
import { ACQUIRE_BUDGET_PER_TICK, ACQUIRE_MAX_CHECKS_PER_SCAN, CHASE_REPATH_TICKS, TICK_RATE, type GameState, type Sim } from '../../src/sim/types';
import {
  attack,
  attackMove,
  battle,
  building,
  cmd,
  emptyBattleState,
  get,
  move,
  rejections,
  resolved,
  run,
  runUntil,
  sideCtx,
  step,
  unit,
  type Battle,
} from './combatHelpers';

const SLACK = registry.combat.meleeReleaseSlack;

/**
 * hp of a unit, 0 once it has been removed. Since WP23's death step (PLAN-M2 2.2 step 11) a unit that reaches 0 hp
 * is removed in the same tick, so "gone" and "hp 0 at the end of the tick" are the same moment.
 */
function hpOf(b: Battle, id: number): number {
  const e = findEntity(b.state, id);
  return e === undefined ? 0 : get(b, id).hp;
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by));
}

// ---------------------------------------------------------------------------
// Timing (4.3)
// ---------------------------------------------------------------------------

describe('attack timing (PLAN-M2 4.3)', () => {
  /** Spearman (id 1) commanded onto a passive villager (id 2) 4 tiles away; records per step. */
  function meleeSetup() {
    const s = emptyBattleState();
    const a = unit(s, 'spearman', 1, 10.5, 10.5);
    const t = unit(s, 'villager', 2, 14.5, 10.5);
    const b = battle(s);
    return { b, a: a.id, t: t.id, p: resolved(1, 'spearman') };
  }

  /** Steps until the attacker's order first reaches phase `attacking`; returns that step's index (0-based). */
  function untilAttacking(b: Battle, a: number, first: ReturnType<typeof attack>): number {
    for (let i = 0; i < 400; i++) {
      step(b, i === 0 ? [first] : []);
      const o = get(b, a).currentOrder;
      if (o !== null && o.type === 'attack' && o.phase === 'attacking') return i;
    }
    throw new Error('never in reach');
  }

  it('first hit lands exactly windupTicks after reaching reach, then every cooldownTicks', () => {
    const { b, a, t, p } = meleeSetup();
    const start = untilAttacking(b, a, attack(b, 1, [a], t));
    expect(get(b, a).combat.windup).toBe(p.windupTicks); // the swing starts on the tick it is in reach
    expect(get(b, a).combat.swingTargetId).toBe(t);
    const dmg = computeDamage(p, resolved(2, 'villager'), registry.combat.minDamage);
    const hits: number[] = [];
    let last = hpOf(b, t);
    for (let i = start + 1; i <= start + p.windupTicks + 3 * p.cooldownTicks; i++) {
      step(b);
      const hp = hpOf(b, t);
      if (hp !== last) {
        expect(last - hp).toBe(dmg);
        hits.push(i);
      }
      last = hp;
    }
    expect(hits.length).toBeGreaterThanOrEqual(3);
    expect(hits[0]).toBe(start + p.windupTicks);
    expect(hits[1]! - hits[0]!).toBe(p.cooldownTicks);
    expect(hits[2]! - hits[1]!).toBe(p.cooldownTicks);
    expect(get(b, t).lastAttackerId).toBe(a);
    expect(get(b, a).facing).toBe(0); // +x
  });

  it('a started wind-up completes after a stop', () => {
    const { b, a, t, p } = meleeSetup();
    const start = untilAttacking(b, a, attack(b, 1, [a], t));
    const full = hpOf(b, t);
    get(b, a).combat.nextScanTick = 1e9; // no auto re-acquisition: isolate the wind-up
    step(b, [cmd(b, 1, { type: 'stop', unitIds: [a] })]);
    expect(get(b, a).currentOrder).toBeNull();
    for (let i = start + 2; i < start + p.windupTicks; i++) step(b);
    expect(hpOf(b, t)).toBe(full);
    step(b); // release tick
    expect(hpOf(b, t)).toBeLessThan(full);
    const after = hpOf(b, t);
    run(b, p.cooldownTicks * 2);
    expect(hpOf(b, t)).toBe(after); // no new swing without an order
  });

  it('a melee release on a target that left reach + slack is wasted', () => {
    const { b, a, t, p } = meleeSetup();
    const start = untilAttacking(b, a, attack(b, 1, [a], t));
    const full = hpOf(b, t);
    const att = get(b, a);
    const victim = get(b, t);
    victim.pos.x = att.pos.x + p.reach + SLACK + 0.3;
    victim.prevPos.x = victim.pos.x;
    for (let i = start + 1; i <= start + p.windupTicks; i++) step(b);
    expect(get(b, a).combat.lastAttackTick).toBe(b.state.tick - 1);
    expect(hpOf(b, t)).toBe(full);
    expect(get(b, a).combat.cooldown).toBe(p.cooldownTicks - p.windupTicks);
  });

  it('a melee release still lands within reach + slack', () => {
    const { b, a, t, p } = meleeSetup();
    const start = untilAttacking(b, a, attack(b, 1, [a], t));
    const full = hpOf(b, t);
    const att = get(b, a);
    const victim = get(b, t);
    victim.pos.x = att.pos.x + p.reach + SLACK - 0.05;
    victim.prevPos.x = victim.pos.x;
    for (let i = start + 1; i <= start + p.windupTicks; i++) step(b);
    expect(hpOf(b, t)).toBeLessThan(full);
  });

  it('ranged units spawn a projectile at release with the 2.4 flight time and fire-time damage', () => {
    const s = emptyBattleState();
    const a = unit(s, 'archer', 1, 10.5, 10.5).id;
    const t = unit(s, 'villager', 2, 13.5, 10.5).id;
    const b = battle(s);
    const p = resolved(1, 'archer');
    const start = untilAttacking(b, a, attack(b, 1, [a], t));
    expect(start).toBe(0); // already in reach
    const spawns: number[] = [];
    let next = b.state.nextProjectileId;
    for (let i = start + 1; i <= start + p.windupTicks + 2 * p.cooldownTicks; i++) {
      step(b);
      if (b.state.nextProjectileId !== next) {
        spawns.push(i);
        if (spawns.length === 1) {
          const proj = b.state.projectiles.find((x) => x.id === next)!;
          const expectedFlight = Math.max(1, Math.ceil((3 * TICK_RATE) / registry.combat.projectileSpeed.arrow));
          expect(proj).toMatchObject({ kind: 'arrow', owner: 1, sourceId: a, sourceType: 'archer', targetId: t });
          expect(proj.from).toEqual({ x: 10.5, y: 10.5 });
          expect(proj.to).toEqual({ x: 13.5, y: 10.5 });
          expect(proj.flightTicks).toBe(expectedFlight);
          expect(proj.damage).toBe(computeDamage(p, resolved(2, 'villager'), registry.combat.minDamage));
        }
        next = b.state.nextProjectileId;
      }
    }
    expect(spawns[0]).toBe(start + p.windupTicks);
    expect(spawns[1]! - spawns[0]!).toBe(p.cooldownTicks);
    expect(spawns[2]! - spawns[1]!).toBe(p.cooldownTicks);
  });
});

// ---------------------------------------------------------------------------
// Simultaneity
// ---------------------------------------------------------------------------

describe('simultaneity', () => {
  function duel(lowIdOnLeft: boolean, type: string): { left: number; right: number } {
    const s = emptyBattleState();
    let leftId: number;
    let rightId: number;
    if (lowIdOnLeft) {
      leftId = unit(s, type, 1, 10.5, 20.5).id;
      rightId = unit(s, type, 2, 15.5, 20.5).id;
    } else {
      rightId = unit(s, type, 2, 15.5, 20.5).id;
      leftId = unit(s, type, 1, 10.5, 20.5).id;
    }
    const b = battle(s);
    const deathTick: Record<number, number> = {};
    step(b, [attack(b, 1, [leftId], rightId), attack(b, 2, [rightId], leftId)]);
    for (let i = 0; i < 3000 && Object.keys(deathTick).length < 2; i++) {
      step(b);
      for (const id of [leftId, rightId]) if (deathTick[id] === undefined && hpOf(b, id) === 0) deathTick[id] = b.state.tick;
    }
    return { left: deathTick[leftId]!, right: deathTick[rightId]! };
  }

  // Archers kill through projectiles (WP22); for them the test below checks that both fire on the same ticks.
  it.each(['swordsman', 'spearman', 'horseman'])('two identical %s duelling die on the same tick in either id order', (type) => {
    const a = duel(true, type);
    const b = duel(false, type);
    expect(a.left).toBeGreaterThan(0);
    expect(a.left).toBe(a.right);
    expect(b.left).toBe(b.right);
    expect(a.left).toBe(b.left);
  });

  it('two identical archers fire their projectiles on the same ticks in either id order', () => {
    for (const lowLeft of [true, false]) {
      const s = emptyBattleState();
      let l: number;
      let r: number;
      if (lowLeft) {
        l = unit(s, 'archer', 1, 10.5, 20.5).id;
        r = unit(s, 'archer', 2, 20.5, 20.5).id;
      } else {
        r = unit(s, 'archer', 2, 20.5, 20.5).id;
        l = unit(s, 'archer', 1, 10.5, 20.5).id;
      }
      const b = battle(s);
      step(b, [attack(b, 1, [l], r), attack(b, 2, [r], l)]);
      const fired: Record<number, number[]> = { [l]: [], [r]: [] };
      for (let i = 0; i < 300; i++) {
        step(b);
        for (const p of b.state.projectiles) if (p.ticksLeft === p.flightTicks - 1) fired[p.sourceId]!.push(b.state.tick);
      }
      expect(fired[l]!.length).toBeGreaterThan(2);
      expect(fired[l]).toEqual(fired[r]);
    }
  });
});

// ---------------------------------------------------------------------------
// Acquisition (4.5)
// ---------------------------------------------------------------------------

function autoTarget(b: Battle, id: number): number | null {
  const o = get(b, id).currentOrder;
  if (o === null) return null;
  if (o.type === 'attack') return o.targetId;
  if (o.type === 'attackMove' || o.type === 'hold') return o.targetId;
  return null;
}

function standGround(s: GameState, ...ids: number[]): void {
  for (const e of s.entities) if (ids.includes(e.id) && e.kind === 'unit') e.stance = 'standGround';
}

describe('acquisition (PLAN-M2 4.5)', () => {
  it('tier order: fighting units before other units before buildings, whatever the distance', () => {
    const s = emptyBattleState();
    const me = unit(s, 'spearman', 1, 10.5, 10.5).id;
    building(s, 'house', 2, 11, 12); // nearest point 1.58 away
    unit(s, 'villager', 2, 12.5, 10.5); // 2 away, tier 2
    const archer = unit(s, 'archer', 2, 14.5, 10.5).id; // 4 away, tier 1
    const far = unit(s, 'spearman', 2, 10.5, 14.9).id; // 4.4 away, tier 1
    standGround(s, archer, far);
    const b = battle(s);
    expect(runUntil(b, () => get(b, me).currentOrder !== null, 20)).toBeGreaterThan(0);
    expect(get(b, me).currentOrder).toMatchObject({ type: 'attack', targetId: archer, auto: true, anchor: { x: 10.5, y: 10.5 } });
  });

  it('tier 2 before buildings; a lone building is acquired', () => {
    const s = emptyBattleState();
    const me = unit(s, 'spearman', 1, 10.5, 10.5).id;
    const house = building(s, 'house', 2, 11, 12).id;
    const vil = unit(s, 'villager', 2, 14.5, 10.5).id;
    const b = battle(s);
    runUntil(b, () => get(b, me).currentOrder !== null, 20);
    expect(autoTarget(b, me)).toBe(vil);

    const s2 = emptyBattleState();
    const me2 = unit(s2, 'spearman', 1, 10.5, 10.5).id;
    const house2 = building(s2, 'house', 2, 11, 12).id;
    const b2 = battle(s2);
    runUntil(b2, () => get(b2, me2).currentOrder !== null, 20);
    expect(autoTarget(b2, me2)).toBe(house2);
    expect(house).toBe(house2);
  });

  it('ties by d² then id', () => {
    for (const lowOnRight of [true, false]) {
      const s = emptyBattleState();
      const me = unit(s, 'spearman', 1, 10.5, 10.5).id;
      const first = unit(s, 'villager', 2, lowOnRight ? 12.5 : 8.5, 10.5).id;
      unit(s, 'villager', 2, lowOnRight ? 8.5 : 12.5, 10.5);
      const b = battle(s);
      runUntil(b, () => get(b, me).currentOrder !== null, 20);
      expect(autoTarget(b, me)).toBe(first); // equal d²: lowest id
    }
    const s = emptyBattleState();
    const me = unit(s, 'spearman', 1, 10.5, 10.5).id;
    unit(s, 'villager', 2, 8.5, 10.5);
    const nearer = unit(s, 'villager', 2, 12.4, 10.5).id;
    const b = battle(s);
    runUntil(b, () => get(b, me).currentOrder !== null, 20);
    expect(autoTarget(b, me)).toBe(nearer);
  });

  it('stand ground scans within reach only and attacks without moving', () => {
    const s = emptyBattleState();
    const me = unit(s, 'spearman', 1, 10.5, 10.5).id;
    const vil = unit(s, 'villager', 2, 13.5, 10.5).id;
    standGround(s, me);
    const b = battle(s);
    run(b, 30);
    expect(get(b, me).currentOrder).toBeNull();
    get(b, vil).pos.x = 11.1;
    get(b, vil).prevPos.x = 11.1;
    const full = hpOf(b, vil);
    run(b, 15 + resolved(1, 'spearman').windupTicks);
    expect(autoTarget(b, me)).toBe(vil);
    expect(hpOf(b, vil)).toBeLessThan(full);
    expect(get(b, me).pos).toEqual({ x: 10.5, y: 10.5 });
    // The target steps out of reach: the stand-ground engagement ends; it does not chase.
    get(b, vil).pos.x = 12.5;
    run(b, 30);
    expect(get(b, me).currentOrder).toBeNull();
    expect(get(b, me).pos).toEqual({ x: 10.5, y: 10.5 });
  });

  it('villagers never scan or retaliate', () => {
    const s = emptyBattleState();
    const me = unit(s, 'villager', 1, 10.5, 10.5).id;
    const enemy = unit(s, 'spearman', 2, 12.5, 10.5).id;
    standGround(s, enemy);
    const b = battle(s);
    applyDamage(sideCtx(b), get(b, me), 1, { id: enemy, owner: 2 });
    run(b, 40);
    expect(get(b, me).currentOrder).toBeNull();
  });

  it('retaliation reaches beyond sight up to retaliateRadius', () => {
    for (const [d, expected] of [
      [8, true],
      [12, false],
    ] as const) {
      const s = emptyBattleState();
      const me = unit(s, 'spearman', 1, 10.5, 10.5).id;
      const shooter = unit(s, 'archer', 2, 10.5 + d, 10.5).id;
      standGround(s, shooter);
      const b = battle(s);
      run(b, 12);
      expect(get(b, me).currentOrder).toBeNull(); // beyond sight (6)
      applyDamage(sideCtx(b), get(b, me), 1, { id: shooter, owner: 2 });
      expect(get(b, me).combat.nextScanTick).toBe(b.state.tick + 1); // the retaliation wake-up
      run(b, 3);
      expect(autoTarget(b, me) === shooter, `distance ${d}`).toBe(expected);
    }
  });

  it('retarget: an out-of-reach target is swapped for an equal-or-lower tier in reach, not a higher tier', () => {
    const s = emptyBattleState();
    const me = unit(s, 'spearman', 1, 10.5, 10.5).id;
    const a = unit(s, 'spearman', 2, 15.5, 10.5).id;
    const vil = unit(s, 'villager', 2, 40.5, 40.5).id;
    const bId = unit(s, 'spearman', 2, 44.5, 44.5).id;
    standGround(s, a, bId);
    const b = battle(s);
    runUntil(b, () => get(b, me).currentOrder !== null, 20);
    expect(autoTarget(b, me)).toBe(a);
    const follow = (id: number) => () => {
      const m = get(b, me);
      const e = get(b, id);
      e.pos.x = m.pos.x;
      e.pos.y = m.pos.y + 0.5;
      e.prevPos.x = e.pos.x;
      e.prevPos.y = e.pos.y;
    };
    follow(vil)();
    run(b, 25, follow(vil)); // a tier-2 villager in reach does not replace a tier-1 target
    expect(autoTarget(b, me)).toBe(a);
    get(b, vil).pos = { x: 40.5, y: 40.5 };
    follow(bId)();
    run(b, 12, follow(bId));
    expect(autoTarget(b, me)).toBe(bId);
  });

  it('the leash ends an auto chase beyond leashRadius and walks back to the anchor', () => {
    const s = emptyBattleState();
    const me = unit(s, 'spearman', 1, 10.5, 10.5).id;
    const horse = unit(s, 'horseman', 2, 15.5, 10.5).id;
    standGround(s, horse);
    const b = battle(s);
    runUntil(b, () => get(b, me).currentOrder !== null, 20);
    expect(autoTarget(b, me)).toBe(horse);
    step(b, [move(b, 2, [horse], 40.5, 10.5)]);
    const at = runUntil(b, () => get(b, me).currentOrder?.type === 'move', 600);
    expect(at).toBeGreaterThan(0);
    const h = get(b, horse);
    expect(dist(h.pos.x, h.pos.y, 10.5, 10.5)).toBeGreaterThan(registry.combat.leashRadius);
    expect(get(b, me).currentOrder).toMatchObject({ type: 'move', x: 10.5, y: 10.5 });
    expect(runUntil(b, () => get(b, me).currentOrder === null, 600)).toBeGreaterThan(0);
    const m = get(b, me);
    expect(dist(m.pos.x, m.pos.y, 10.5, 10.5)).toBeLessThan(0.5);
  });

  it('a commanded attack has no leash', () => {
    const s = emptyBattleState();
    const me = unit(s, 'spearman', 1, 10.5, 10.5).id;
    const vil = unit(s, 'villager', 2, 15.5, 10.5).id;
    const b = battle(s);
    step(b, [attack(b, 1, [me], vil), move(b, 2, [vil], 40.5, 10.5)]);
    run(b, 500);
    const o = get(b, me).currentOrder;
    expect(o).toMatchObject({ type: 'attack', targetId: vil, auto: false });
    expect(get(b, me).pos.x).toBeGreaterThan(25);
  });

  it('attack-move engages an enemy met on the way, kills it, and resumes the walk', () => {
    const s = emptyBattleState();
    const me = unit(s, 'swordsman', 1, 5.5, 10.5).id;
    const vil = unit(s, 'villager', 2, 15.5, 10.5).id;
    const b = battle(s);
    step(b, [attackMove(b, 1, [me], 30.5, 10.5)]);
    expect(runUntil(b, () => (get(b, me).currentOrder as { phase?: string } | null)?.phase === 'engaging', 300)).toBeGreaterThan(0);
    expect(autoTarget(b, me)).toBe(vil);
    expect(runUntil(b, () => hpOf(b, vil) === 0, 600)).toBeGreaterThan(0);
    run(b, 2);
    expect(get(b, me).currentOrder).toMatchObject({ type: 'attackMove', phase: 'walking', targetId: null });
    expect(runUntil(b, () => get(b, me).currentOrder === null, 800)).toBeGreaterThan(0);
    const m = get(b, me);
    expect(dist(m.pos.x, m.pos.y, 30.5, 10.5)).toBeLessThan(0.5);
  });

  it('hold never moves and attacks only what is in reach', () => {
    const s = emptyBattleState();
    const me = unit(s, 'spearman', 1, 10.5, 10.5).id;
    const vil = unit(s, 'villager', 2, 13.5, 4.5).id;
    const b = battle(s);
    step(b, [cmd(b, 1, { type: 'hold', unitIds: [me] }), move(b, 2, [vil], 13.5, 20.5)]);
    const full = hpOf(b, vil);
    expect(runUntil(b, () => get(b, vil).currentOrder === null, 600)).toBeGreaterThan(0);
    expect(get(b, me).pos).toEqual({ x: 10.5, y: 10.5 });
    expect(hpOf(b, vil)).toBe(full);
    expect(get(b, me).currentOrder).toMatchObject({ type: 'hold', targetId: null });
    step(b, [move(b, 2, [vil], 11.1, 10.5)]);
    expect(runUntil(b, () => hpOf(b, vil) < full, 600)).toBeGreaterThan(0);
    expect(get(b, me).pos).toEqual({ x: 10.5, y: 10.5 });
    // The target walks off: no chase.
    step(b, [move(b, 2, [vil], 20.5, 10.5)]);
    run(b, 200);
    expect(get(b, me).pos).toEqual({ x: 10.5, y: 10.5 });
    expect(get(b, me).currentOrder).toMatchObject({ type: 'hold', targetId: null });
  });

  it('a move order ignores enemies', () => {
    const s = emptyBattleState();
    const me = unit(s, 'spearman', 1, 5.5, 10.5).id;
    const vil = unit(s, 'villager', 2, 15.5, 11.0).id;
    const b = battle(s);
    step(b, [move(b, 1, [me], 30.5, 10.5)]);
    runUntil(b, () => get(b, me).currentOrder === null, 800);
    expect(hpOf(b, vil)).toBe(resolved(2, 'villager').maxHp);
  });
});

// ---------------------------------------------------------------------------
// Budgets and the spatial index (2.3, 4.5)
// ---------------------------------------------------------------------------

describe('acquisition budget and the spatial index', () => {
  /** A crowd of 121 idle spearmen and three enemies, created in an id order given by `perm`. */
  function crowd(reverse: boolean) {
    const s = emptyBattleState();
    const specs: { kind: 'own' | 'enemy'; x: number; y: number }[] = [];
    for (let i = 0; i < 11; i++) for (let j = 0; j < 11; j++) specs.push({ kind: 'own', x: 10.2 + 0.7 * i, y: 10.2 + 0.7 * j });
    specs.push({ kind: 'enemy', x: 20.13, y: 14.71 }, { kind: 'enemy', x: 21.37, y: 17.29 }, { kind: 'enemy', x: 19.61, y: 9.83 });
    const order = reverse ? [...specs].reverse() : specs;
    const idOf = new Map<string, number>();
    for (const sp of order) {
      const u = unit(s, 'spearman', sp.kind === 'own' ? 1 : 2, sp.x, sp.y);
      if (sp.kind === 'enemy') u.stance = 'standGround';
      u.combat.nextScanTick = 0; // everyone due at once
      idOf.set(`${sp.x},${sp.y}`, u.id);
    }
    const b = battle(s);
    const keyOf = new Map<number, string>();
    for (const [k, id] of idOf) keyOf.set(id, k);
    return { b, specs, idOf, keyOf };
  }

  it('an exhausted budget defers due units to the next tick, deterministically and independent of id order', () => {
    const results: Map<string, string | null>[] = [];
    for (const reverse of [false, true]) {
      const { b, specs, idOf, keyOf } = crowd(reverse);
      step(b);
      const scanned = specs.filter((sp) => get(b, idOf.get(`${sp.x},${sp.y}`)!).combat.nextScanTick > 0).length;
      expect(scanned).toBeLessThan(specs.length); // the budget ran out on tick 0
      expect(scanned).toBeGreaterThanOrEqual(Math.floor(ACQUIRE_BUDGET_PER_TICK / ACQUIRE_MAX_CHECKS_PER_SCAN));
      run(b, 3);
      for (const sp of specs) expect(get(b, idOf.get(`${sp.x},${sp.y}`)!).combat.nextScanTick).toBeGreaterThan(0);
      const map = new Map<string, string | null>();
      for (const sp of specs) {
        if (sp.kind !== 'own') continue;
        const id = idOf.get(`${sp.x},${sp.y}`)!;
        const t = autoTarget(b, id);
        map.set(`${sp.x},${sp.y}`, t === null ? null : keyOf.get(t)!);
      }
      results.push(map);
    }
    expect([...results[0]!.values()].filter((v) => v !== null).length).toBeGreaterThan(10);
    expect([...results[1]!.entries()].sort()).toEqual([...results[0]!.entries()].sort());
  });

  it('queries visit every unit and building within r once, in ascending id within a cell, and honour the budget', () => {
    const s = emptyBattleState();
    const pts: [number, number][] = [];
    for (let i = 0; i < 60; i++) pts.push([3 + ((i * 7.3) % 40), 3 + ((i * 11.9) % 40)]);
    for (const [x, y] of pts) unit(s, 'spearman', 1 + (pts.length % 2), x, y);
    const houses = [building(s, 'house', 2, 3, 3).id, building(s, 'house', 2, 7, 7).id, building(s, 'barracks', 2, 22, 22).id];
    const b = battle(s);
    step(b);
    const ctx = sideCtx(b);
    rebuildSpatialIndex(ctx); // as step 4 does
    for (const [qx, qy, r] of [
      [20, 20, 6],
      [5, 5, 3],
      [0, 0, 100],
      [44, 2, 4.5],
    ] as const) {
      const seen: number[] = [];
      visitUnitsNear(ctx, qx, qy, r, 1e9, (u) => {
        seen.push(u.id);
        return false;
      });
      const expected = b.state.entities.filter((e) => e.kind === 'unit' && dist(e.pos.x, e.pos.y, qx, qy) <= r).map((e) => e.id);
      expect([...seen].sort((x, y) => x - y)).toEqual(expected);
      const seenB: number[] = [];
      visitBuildingsNear(ctx, qx, qy, r, 1e9, (e) => {
        seenB.push(e.id);
        return false;
      });
      const expB = houses.filter((id) => {
        const e = b.state.entities.find((x) => x.id === id)!;
        if (e.kind !== 'building') return false;
        const size = registry.building(e.typeId).footprint;
        const nx = Math.min(Math.max(qx, e.tile.tx), e.tile.tx + size);
        const ny = Math.min(Math.max(qy, e.tile.ty), e.tile.ty + size);
        return dist(nx, ny, qx, qy) <= r;
      });
      expect([...seenB].sort((x, y) => x - y)).toEqual(expB);
    }
    let visited = 0;
    const used = visitUnitsNear(ctx, 20, 20, 100, 7, () => {
      visited++;
      return false;
    });
    expect(used).toBe(7);
    expect(visited).toBeLessThanOrEqual(7);
    expect(visitUnitsNear(ctx, 20, 20, 100, 1e9, () => true)).toBe(1); // stop on true
  });

  it('a scan stops at its check budget', () => {
    const { b, idOf, specs } = crowd(false);
    const ctx = sideCtx(b);
    step(b);
    rebuildSpatialIndex(ctx);
    const me = get(b, idOf.get(`${specs[60]!.x},${specs[60]!.y}`)!);
    const profile = unitCombat(ctx, 1, 'spearman');
    const r = scanForTarget(ctx, me, profile, { radius: profile.sight, inReachOnly: false, maxTier: 3, retaliateRadius: null }, 20);
    expect(r.checks).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// Chasing (4.6)
// ---------------------------------------------------------------------------

describe('chasing (PLAN-M2 4.6)', () => {
  function fleeing(chasers: number) {
    const s = emptyBattleState(64);
    const ids: number[] = [];
    for (let i = 0; i < chasers; i++) ids.push(unit(s, 'spearman', 1, 5.5 + (i % 5), 5.5 + Math.floor(i / 5)).id);
    const horse = unit(s, 'horseman', 2, 20.5, 20.5).id;
    standGround(s, horse);
    const b = battle(s);
    return { b, ids, horse };
  }

  const ZIGZAG: [number, number][] = [
    [50.5, 20.5],
    [50.5, 50.5],
    [20.5, 50.5],
    [20.5, 20.5],
    [55.5, 35.5],
  ];

  it('chase re-path requests are throttled to one per CHASE_REPATH_TICKS', () => {
    const { b, ids, horse } = fleeing(1);
    const me = ids[0]!;
    step(b, [attack(b, 1, [me], horse)]);
    const requestTicks: number[] = [];
    let horseRequests = 0;
    for (let i = 0; i < 400; i++) {
      const cmds = i % 80 === 0 ? [move(b, 2, [horse], ...ZIGZAG[(i / 80) % ZIGZAG.length]!)] : [];
      if (cmds.length > 0) horseRequests++;
      const before = b.state.nextPathRequestId;
      const tick = b.state.tick;
      step(b, cmds);
      const made = b.state.nextPathRequestId - before - cmds.length;
      for (let k = 0; k < made; k++) requestTicks.push(tick);
    }
    expect(horseRequests).toBeGreaterThan(0);
    expect(requestTicks.length).toBeGreaterThan(3);
    for (let k = 1; k < requestTicks.length; k++) expect(requestTicks[k]! - requestTicks[k - 1]!).toBeGreaterThanOrEqual(CHASE_REPATH_TICKS);
  });

  it('ten units chasing a fleeing horseman make fewer than one path request per unit per 10 ticks', () => {
    const { b, ids, horse } = fleeing(10);
    step(b, [attack(b, 1, ids, horse)]);
    const before = b.state.nextPathRequestId;
    let horseCmds = 0;
    const T = 600;
    for (let i = 0; i < T; i++) {
      const cmds = i % 80 === 0 ? [move(b, 2, [horse], ...ZIGZAG[(i / 80) % ZIGZAG.length]!)] : [];
      horseCmds += cmds.length;
      step(b, cmds);
      expect(b.state.pathQueue.length).toBeLessThanOrEqual(ids.length + 1);
    }
    const chaserRequests = b.state.nextPathRequestId - before - horseCmds;
    expect(chaserRequests).toBeLessThan((ids.length * T) / CHASE_REPATH_TICKS);
  });

  it('a chase ends when the target dies, and the unit scans again next tick', () => {
    const s = emptyBattleState();
    const me = unit(s, 'spearman', 1, 10.5, 10.5).id;
    const vil = unit(s, 'villager', 2, 14.5, 10.5).id;
    const b = battle(s);
    step(b, [attack(b, 1, [me], vil)]);
    run(b, 5);
    get(b, vil).hp = 0;
    step(b);
    expect(get(b, me).currentOrder).toBeNull();
    expect(get(b, me).combat.nextScanTick).toBe(b.state.tick); // set to (run tick) + 1
  });

  it('melee units attacking a building walk to the footprint and hit it', () => {
    const s = emptyBattleState();
    const me = unit(s, 'swordsman', 1, 5.5, 5.5).id;
    const house = building(s, 'house', 2, 20, 20).id;
    const b = battle(s);
    const startHp = b.state.entities.find((e) => e.id === house)!;
    const full = (startHp as { hp: number }).hp;
    step(b, [attack(b, 1, [me], house)]);
    expect(
      runUntil(b, () => (b.state.entities.find((e) => e.id === house) as { hp: number }).hp < full, 1200),
    ).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Commands (4.8)
// ---------------------------------------------------------------------------

describe('combat commands (PLAN-M2 4.8)', () => {
  function world() {
    const s = emptyBattleState();
    const me = unit(s, 'spearman', 1, 10.5, 10.5).id;
    const mine2 = unit(s, 'spearman', 1, 11.5, 10.5).id;
    const ram = unit(s, 'batteringRam', 1, 12.5, 12.5).id;
    const enemy = unit(s, 'spearman', 2, 30.5, 30.5).id;
    const house = building(s, 'house', 2, 35, 35).id;
    const tree = createNode(s, 'tree', 40, 5, 100).id;
    standGround(s, enemy);
    return { b: battle(s), me, mine2, ram, enemy, house, tree };
  }

  it('attack: validation and reject reasons', () => {
    const w = world();
    const { b } = w;
    expect(rejections(step(b, [attack(b, 1, [w.me], 9999)]))).toEqual(['unknownEntity']);
    expect(rejections(step(b, [attack(b, 1, [w.me], w.mine2)]))).toEqual(['invalidTarget']);
    expect(rejections(step(b, [attack(b, 1, [w.me], w.tree)]))).toEqual(['invalidTarget']);
    expect(rejections(step(b, [attack(b, 1, [w.me, w.ram], w.enemy)]))).toEqual(['cannotPerform']);
    expect(rejections(step(b, [attack(b, 1, [w.me, w.enemy], w.house)]))).toEqual(['notOwner']);
    expect(get(b, w.me).currentOrder).toBeNull();
    expect(rejections(step(b, [attack(b, 1, [w.me, w.ram], w.house)]))).toEqual([]);
    expect(get(b, w.me).currentOrder).toMatchObject({ type: 'attack', targetId: w.house, auto: false, anchor: null });
    expect(get(b, w.ram).currentOrder).toMatchObject({ type: 'attack', targetId: w.house });
    get(b, w.enemy).hp = 0;
    expect(rejections(step(b, [attack(b, 1, [w.me], w.enemy)]))).toEqual(['invalidTarget']);
  });

  it('attack with queue appends; a queued attack on a dead target is skipped', () => {
    const w = world();
    const { b } = w;
    step(b, [move(b, 1, [w.me], 12.5, 10.5), attack(b, 1, [w.me], w.enemy, true)]);
    expect(get(b, w.me).currentOrder?.type).toBe('move');
    expect(get(b, w.me).orderQueue).toEqual([{ type: 'attack', targetId: w.enemy, auto: false }]);
    get(b, w.enemy).hp = 0;
    runUntil(b, () => get(b, w.me).orderQueue.length === 0, 200);
    run(b, 2);
    expect(get(b, w.me).currentOrder).toBeNull();
  });

  it('attackMove: point inside the map, group slots like move', () => {
    const w = world();
    const { b } = w;
    expect(rejections(step(b, [attackMove(b, 1, [w.me], -1, 5)]))).toEqual(['invalidCommand']);
    expect(rejections(step(b, [attackMove(b, 1, [w.me], 5, 48)]))).toEqual(['invalidCommand']);
    expect(rejections(step(b, [attackMove(b, 1, [w.me, w.mine2], 20.5, 20.5)]))).toEqual([]);
    const a = get(b, w.me).currentOrder as { x: number; y: number };
    const c = get(b, w.mine2).currentOrder as { x: number; y: number };
    expect(get(b, w.me).currentOrder?.type).toBe('attackMove');
    expect(Math.floor(a.x) !== Math.floor(c.x) || Math.floor(a.y) !== Math.floor(c.y)).toBe(true);
  });

  it('hold replaces orders; setStance changes stance only', () => {
    const w = world();
    const { b } = w;
    step(b, [move(b, 1, [w.me], 20.5, 10.5)]);
    expect(rejections(step(b, [cmd(b, 1, { type: 'setStance', unitIds: [w.me, w.mine2], stance: 'standGround' })]))).toEqual([]);
    expect(get(b, w.me).stance).toBe('standGround');
    expect(get(b, w.mine2).stance).toBe('standGround');
    expect(get(b, w.me).currentOrder?.type).toBe('move');
    expect(rejections(step(b, [cmd(b, 1, { type: 'setStance', unitIds: [w.me, w.enemy], stance: 'aggressive' })]))).toEqual(['notOwner']);
    expect(get(b, w.me).stance).toBe('standGround');
    expect(rejections(step(b, [cmd(b, 1, { type: 'hold', unitIds: [w.me] })]))).toEqual([]);
    const pos = { ...get(b, w.me).pos };
    run(b, 20);
    expect(get(b, w.me).currentOrder).toMatchObject({ type: 'hold' });
    expect(get(b, w.me).pos).toEqual(pos);
    expect(rejections(step(b, [cmd(b, 1, { type: 'hold', unitIds: [w.enemy] })]))).toEqual(['notOwner']);
  });

  it('siege scans for buildings only', () => {
    const s = emptyBattleState();
    const ram = unit(s, 'batteringRam', 1, 10.5, 10.5).id;
    unit(s, 'villager', 2, 11.5, 10.5);
    const b = battle(s);
    run(b, 20);
    expect(get(b, ram).currentOrder).toBeNull();
    const s2 = emptyBattleState();
    const ram2 = unit(s2, 'batteringRam', 1, 10.5, 10.5).id;
    unit(s2, 'villager', 2, 11.5, 10.5);
    const house = building(s2, 'house', 2, 12, 12).id;
    const b2 = battle(s2);
    run(b2, 20);
    expect(autoTarget(b2, ram2)).toBe(house);
  });
});

// ---------------------------------------------------------------------------
// Determinism of a scripted skirmish
// ---------------------------------------------------------------------------

describe('determinism: scripted melee and ranged skirmish', () => {
  const ROSTER = ['spearman', 'spearman', 'spearman', 'swordsman', 'swordsman', 'archer', 'archer', 'archer', 'horseman', 'villager'];

  function skirmish(): { sim: Sim; b: Battle } {
    const s = emptyBattleState();
    ROSTER.forEach((type, i) => {
      unit(s, type, 1, 8.5 + (i % 3), 18.5 + i);
      unit(s, type, 2, 39.5 - (i % 3), 29.5 - i);
    });
    const b = battle(s);
    const p1 = b.state.entities.filter((e) => e.kind === 'unit' && e.owner === 1).map((e) => e.id);
    const p2 = b.state.entities.filter((e) => e.kind === 'unit' && e.owner === 2).map((e) => e.id);
    step(b, [attackMove(b, 1, p1, 38.5, 28.5), attackMove(b, 2, p2, 9.5, 19.5)]);
    return { sim: b.sim, b };
  }

  function hashes(sim: Sim, from: number, to: number, every: number): string[] {
    const out: string[] = [];
    for (let t = from; t < to; t++) {
      sim.step([]);
      if ((t + 1) % every === 0) out.push(`${sim.state.tick}:${hashState(sim.state)}`);
    }
    return out;
  }

  it('two runs give the same hashes, and a save/load mid-fight continues identically', () => {
    const a = skirmish();
    const b = skirmish();
    const ha = hashes(a.sim, 1, 900, 50);
    const hb = hashes(b.sim, 1, 300, 50);
    const loaded = deserialize(serialize(b.sim));
    expect(hashState(loaded.state)).toBe(hashState(b.sim.state));
    const hc = hashes(loaded, 300, 900, 50);
    expect([...hb, ...hc]).toEqual(ha);

    // It really was a fight: hp lost on both sides, projectiles fired, melee blows landed.
    const units = a.sim.state.entities.filter((e) => e.kind === 'unit');
    for (const owner of [1, 2]) {
      expect(units.some((u) => u.owner === owner && u.kind === 'unit' && u.hp < unitCombat(sideCtx(a.b), owner, u.typeId).maxHp)).toBe(true);
    }
    expect(a.sim.state.nextProjectileId).toBeGreaterThan(5);
  });
});
