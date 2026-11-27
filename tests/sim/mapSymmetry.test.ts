/** WP24: two-player map fairness (PLAN-M2 4.15) and M1 byte-identity of one-player maps. */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hashState } from '../../src/sim/hash';
import type { BuildingEntity, ResourceNodeEntity, UnitEntity } from '../../src/sim/types';
import { fixtureData, generate } from './fixtures';

const SIZE = 120;

function nodesOf(state: ReturnType<typeof generate>['state']): ResourceNodeEntity[] {
  return state.entities.filter((e): e is ResourceNodeEntity => e.kind === 'node');
}

describe('two-player map (PLAN-M2 4.15)', () => {
  it('is point-symmetric with mirrored resources over 50 seeds', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const { state, report } = generate(seed * 7919, 2);
      expect(report.valid, `seed ${seed}`).toBe(true);
      const nodes = nodesOf(state);
      const key = (typeId: string, tx: number, ty: number, amount: number): string => `${typeId}@${tx},${ty}=${amount}`;
      const keys = new Set(nodes.map((n) => key(n.typeId, n.tile.tx, n.tile.ty, n.amount)));
      for (const n of nodes) {
        const size = fixtureData.node(n.typeId).footprint;
        const m = key(n.typeId, SIZE - n.tile.tx - size, SIZE - n.tile.ty - size, n.amount);
        expect(keys.has(m), `seed ${seed}: mirror of ${n.id}`).toBe(true);
      }
      // Player 1's nodes have lower ids than their mirrors.
      expect(nodes.length % 2).toBe(0);

      // Town Centers and starting units mirror.
      const [a, b] = report.starts;
      expect(a!.anchor.x + b!.anchor.x).toBe(SIZE);
      expect(a!.anchor.y + b!.anchor.y).toBe(SIZE);
      const tc1 = state.entities.find((e) => e.id === a!.townCenterId) as BuildingEntity;
      const tc2 = state.entities.find((e) => e.id === b!.townCenterId) as BuildingEntity;
      const tcSize = fixtureData.building(tc1.typeId).footprint;
      expect(tc2.tile).toEqual({ tx: SIZE - tc1.tile.tx - tcSize, ty: SIZE - tc1.tile.ty - tcSize });
      const units = (ids: number[]): UnitEntity[] => ids.map((id) => state.entities.find((e) => e.id === id) as UnitEntity);
      const u1 = units(a!.unitIds);
      const u2 = units(b!.unitIds);
      expect(u2).toHaveLength(u1.length);
      u1.forEach((u, i) => {
        expect(u2[i]!.typeId).toBe(u.typeId);
        expect(u2[i]!.pos).toEqual({ x: SIZE - u.pos.x, y: SIZE - u.pos.y });
      });

      // Per-player multisets of (resource, amount, distance to own Town Center) are identical.
      const multiset = (anchor: { x: number; y: number }, ids: Iterable<ResourceNodeEntity>): string[] => {
        const out: string[] = [];
        for (const n of ids) {
          const size = fixtureData.node(n.typeId).footprint;
          const d = Math.sqrt((n.tile.tx + size / 2 - anchor.x) ** 2 + (n.tile.ty + size / 2 - anchor.y) ** 2);
          out.push(`${n.typeId}/${n.amount}/${d.toFixed(6)}`);
        }
        return out.sort();
      };
      const nearest = (n: ResourceNodeEntity): 0 | 1 | 2 => {
        const size = fixtureData.node(n.typeId).footprint;
        const cx = n.tile.tx + size / 2;
        const cy = n.tile.ty + size / 2;
        const d1 = (cx - a!.anchor.x) ** 2 + (cy - a!.anchor.y) ** 2;
        const d2 = (cx - b!.anchor.x) ** 2 + (cy - b!.anchor.y) ** 2;
        return d1 === d2 ? 2 : d1 < d2 ? 0 : 1; // 2: equidistant (on the bisector), counted for neither
      };
      const m1 = multiset(a!.anchor, nodes.filter((n) => nearest(n) === 0));
      const m2 = multiset(b!.anchor, nodes.filter((n) => nearest(n) === 1));
      expect(m2).toEqual(m1);

      // Guaranteed resources: same kinds and amounts at the same distances for both players.
      const g = (s: typeof a): string[] =>
        s!.guaranteed
          .flatMap((grp) => grp.nodeIds.map((id) => state.entities.find((e) => e.id === id) as ResourceNodeEntity))
          .map((n) => `${grp(s!, n.id)}/${n.typeId}/${n.amount}`)
          .sort();
      function grp(s: NonNullable<typeof a>, id: number): string {
        return s.guaranteed.find((x) => x.nodeIds.includes(id))!.kind;
      }
      expect(g(b)).toEqual(g(a));
    }
  });

  it('leaves the three anti-diagonals between the halves free of scatter and forest', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { state, report } = generate(seed * 104729, 2);
      const guaranteed = new Set(report.starts.flatMap((s) => s.guaranteed.flatMap((gr) => gr.nodeIds)));
      for (const n of nodesOf(state)) {
        if (guaranteed.has(n.id)) continue;
        const size = fixtureData.node(n.typeId).footprint;
        const lo = n.tile.tx + n.tile.ty;
        const hi = lo + 2 * (size - 1);
        const inGap = (s: number): boolean => s > SIZE - 3 && s < SIZE + 1;
        expect(inGap(lo) || inGap(hi), `seed ${seed} node ${n.id}`).toBe(false);
      }
    }
  });

  it('is deterministic', () => {
    expect(hashState(generate(31, 2).state)).toBe(hashState(generate(31, 2).state));
  });

  it('works on small maps', () => {
    for (let seed = 1; seed <= 10; seed++) {
      expect(generate(seed, 2, 64).report.valid, `seed ${seed}`).toBe(true);
    }
  });
});

describe('one-player maps stay byte-identical to Milestone 1', () => {
  const baseline = JSON.parse(readFileSync(new URL('./fixtures/mapgen-m1-hashes.json', import.meta.url), 'utf8')) as Record<
    string,
    string
  >;
  it('matches the state hashes recorded from the Milestone 1 generator (20 seeds x 2 sizes)', () => {
    const keys = Object.keys(baseline);
    expect(keys).toHaveLength(40);
    for (const k of keys) {
      const [seed, size] = k.split(':').map(Number) as [number, number];
      expect(hashState(generate(seed, 1, size).state), k).toBe(baseline[k]);
    }
  });
});
