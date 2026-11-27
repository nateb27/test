/**
 * Reaching a building's footprint (PLAN-M2 4.2, 4.6; WP33 hardening). A unit with an `attack` order on a building that
 * stands next to the footprint must either be in reach or walk to a spot from which it is: never stand still forever
 * with an empty path. Every unit type that can attack (reach, the trebuchet's minimum range), footprints of size 1 to 4
 * (size 1 is a test-only building), all 8 approach directions, and a building crowded by attackers.
 */

import { describe, expect, it } from 'vitest';
import { createRegistry, registry } from '../../src/data/index';
import type { BuildingDef, DataRegistry } from '../../src/data/schema';
import { createBuilding, createUnit, findEntity } from '../../src/sim/entities';
import { createInitialState, simFromState } from '../../src/sim/sim';
import type { Command, GameState, Sim, UnitEntity } from '../../src/sim/types';

const house = registry.building('house');
const post: BuildingDef = {
  ...house,
  id: 'testPost',
  name: 'Post',
  footprint: 1,
  buildable: false,
};
const data: DataRegistry = createRegistry({
  units: registry.units,
  buildings: [...registry.buildings, post],
  techs: registry.techs,
  ages: registry.ages,
  civs: registry.civs,
  nodes: registry.nodes,
  terrains: registry.terrains,
  start: registry.start,
  combat: registry.combat,
});

const BY_SIZE: Record<number, string> = {
  1: 'testPost',
  2: 'house',
  3: 'barracks',
  4: 'townCenter',
};
const ATTACKERS = ['villager', 'spearman', 'swordsman', 'archer', 'horseman', 'lancer', 'cataphract', 'batteringRam', 'trebuchet', 'siphonarios'];

/** The 8 approach directions: (sx, sy) in {-1, 0, 1}², not both 0. */
const DIRS: [number, number][] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
];

function emptyState(size = 40): GameState {
  return createInitialState(
    {
      seed: 1,
      mapSize: size,
      players: [{ civ: 'byzantines' }, { civ: 'byzantines' }],
      mode: 'sandbox',
    },
    data,
  );
}

/**
 * Position just outside the footprint `[tx, tx+size]²` in direction (sx, sy): diagonally off a corner at 0.6 per axis
 * (0.85 from the corner), or 0.9 off the middle of a side, both outside the base reach of 0.75.
 */
function besideFootprint(tx: number, ty: number, size: number, sx: number, sy: number): { x: number; y: number } {
  const coord = (t: number, s: number, off: number): number => (s < 0 ? t - off : s > 0 ? t + size + off : t + size / 2 + 0.13);
  const off = sx !== 0 && sy !== 0 ? 0.6 : 0.9;
  return { x: coord(tx, sx, off), y: coord(ty, sy, off) };
}

let seq = 0;
function attackCmd(unitIds: number[], targetId: number): Command {
  seq += 1;
  return { type: 'attack', playerId: 1, seq, unitIds, targetId, queue: false };
}

/** Ticks until the building first loses hp (or -1 after `max`). */
function ticksToFirstDamage(sim: Sim, buildingId: number, max: number): number {
  const hpOf = (): number => {
    const e = findEntity(sim.state as GameState, buildingId);
    return e !== undefined && e.kind === 'building' ? e.hp : 0;
  };
  const hp0 = hpOf();
  for (let t = 1; t <= max; t++) {
    sim.step([]);
    if (hpOf() < hp0) return t;
  }
  return -1;
}

describe('a unit beside a footprint reaches it (defect: empty path next to a building)', () => {
  for (const size of [1, 2, 3, 4]) {
    for (const type of ATTACKERS) {
      it(`${type} against a size-${size} footprint from all 8 directions`, () => {
        const failures: string[] = [];
        for (const [sx, sy] of DIRS) {
          const state = emptyState();
          const tx = 18;
          const ty = 18;
          // Unfinished, so a Town Center does not shoot back; a foundation is a valid target with the same footprint.
          const b = createBuilding(state, BY_SIZE[size]!, 2, tx, ty, false);
          const p = besideFootprint(tx, ty, size, sx, sy);
          const u = createUnit(state, type, 1, p.x, p.y);
          const sim = simFromState(state, data);
          sim.step([attackCmd([u.id], b.id)]);
          // Trebuchet: backs off out of its minimum range (3.5 tiles at 0.8 tiles/s), winds up 2 s, stone flies.
          const t = ticksToFirstDamage(sim, b.id, 600);
          if (t < 0) {
            const me = findEntity(sim.state as GameState, u.id) as UnitEntity;
            failures.push(
              `(${sx},${sy}) from (${p.x},${p.y}) stuck at (${me.pos.x.toFixed(3)},${me.pos.y.toFixed(3)}) order ${JSON.stringify(me.currentOrder)}`,
            );
          }
        }
        expect(failures).toEqual([]);
      });
    }
  }

  it('a building surrounded by attackers: every melee attacker keeps landing blows', () => {
    const state = emptyState();
    const tx = 18;
    const ty = 18;
    const b = createBuilding(state, 'barracks', 2, tx, ty, true);
    const ids: number[] = [];
    const types = ['spearman', 'swordsman', 'horseman', 'cataphract', 'villager', 'lancer'];
    let k = 0;
    // 24 melee attackers in a ring 0.6 to 1.0 tiles off the 3x3 footprint, all 8 directions and between.
    for (let i = 0; i < 24; i++) {
      const side = i % 4;
      const along = 0.25 + (((i >> 2) * 0.5) % 3.4);
      const off = 0.6 + (i % 3) * 0.2;
      const x = side === 0 ? tx - off : side === 1 ? tx + 3 + off : tx - 0.5 + along;
      const y = side === 2 ? ty - off : side === 3 ? ty + 3 + off : ty - 0.5 + along;
      ids.push(createUnit(state, types[k++ % types.length]!, 1, x, y).id);
    }
    const sim = simFromState(state, data);
    sim.step([attackCmd(ids, b.id)]);
    for (let t = 0; t < 400; t++) sim.step([]);
    const now = sim.state.tick;
    const stale: string[] = [];
    for (const id of ids) {
      const u = findEntity(sim.state as GameState, id) as UnitEntity;
      const last = u.combat.lastAttackTick;
      if (last === null || now - last > 120) stale.push(`${u.typeId} ${id} last swing ${last} at (${u.pos.x.toFixed(2)},${u.pos.y.toFixed(2)})`);
    }
    expect(stale).toEqual([]);
  });

  it('the crowded building plays out the same whatever the attackers creation order (ids permuted)', () => {
    const run = (reverse: boolean): string[] => {
      const state = emptyState();
      const b = createBuilding(state, 'barracks', 2, 18, 18, true);
      const types = ['spearman', 'swordsman', 'horseman', 'cataphract', 'villager', 'lancer'];
      const slots: { type: string; x: number; y: number }[] = [];
      for (let i = 0; i < 18; i++) {
        const side = i % 4;
        // Irregular offsets: no two attackers equidistant from anything, none coincident (ties go by id, by rule).
        const along = 0.31 + ((i * 0.613) % 3.1);
        const off = 0.55 + ((i * 0.137) % 0.45);
        slots.push({
          type: types[i % types.length]!,
          x: side === 0 ? 18 - off : side === 1 ? 21 + off : 17.5 + along,
          y: side === 2 ? 18 - off : side === 3 ? 21 + off : 17.5 + along,
        });
      }
      const order = reverse ? [...slots.keys()].reverse() : [...slots.keys()];
      const slotOf = new Map<number, number>();
      for (const i of order) slotOf.set(createUnit(state, slots[i]!.type, 1, slots[i]!.x, slots[i]!.y).id, i);
      const sim = simFromState(state, data);
      sim.step([attackCmd([...slotOf.keys()].sort((p, q) => p - q), b.id)]);
      const out: string[] = [];
      for (let t = 0; t < 300; t++) {
        sim.step([]);
        if (sim.state.tick % 20 !== 0) continue;
        const bb = findEntity(sim.state as GameState, b.id);
        const rows = (sim.state.entities as GameState['entities'])
          .filter((e): e is UnitEntity => e.kind === 'unit')
          .map((u) => `${slotOf.get(u.id)} ${u.pos.x},${u.pos.y} ${u.combat.lastAttackTick}`)
          .sort();
        out.push(`${sim.state.tick} ${bb !== undefined && bb.kind === 'building' ? bb.hp : 0} ${rows.join('|')}`);
      }
      return out;
    };
    expect(run(true)).toEqual(run(false));
  });
});
