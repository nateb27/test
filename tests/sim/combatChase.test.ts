/**
 * WP21 chasing (PLAN-M2 4.6): `directPath` is used for unit targets within CHASE_DIRECT_DISTANCE, and only there.
 * `directPath` itself belongs to WP24 (a stub returning false until it lands); this file replaces it with a simple
 * straight-line version to check the engagement helper's side of the contract.
 */

import { describe, expect, it, vi } from 'vitest';
import type * as Follow from '../../src/sim/path/follow';
import { CHASE_DIRECT_DISTANCE, type SimContext, type UnitEntity } from '../../src/sim/types';
import { attack, battle, emptyBattleState, get, resolved, run, step, unit } from './combatHelpers';

const calls: number[] = [];

vi.mock('../../src/sim/path/follow', async (importOriginal) => {
  const original = await importOriginal<typeof Follow>();
  return {
    ...original,
    directPath: (ctx: SimContext, u: UnitEntity, x: number, y: number): boolean => {
      calls.push(Math.sqrt((u.pos.x - x) * (u.pos.x - x) + (u.pos.y - y) * (u.pos.y - y)));
      u.path = { waypoints: [{ x, y }], nextIndex: 0, occupancyVersion: ctx.state.occupancyVersion };
      return true;
    },
  };
});

describe('chasing with directPath (PLAN-M2 4.6)', () => {
  it('uses directPath only within CHASE_DIRECT_DISTANCE, and then requests no A* path', () => {
    const s = emptyBattleState();
    const me = unit(s, 'spearman', 1, 10.5, 10.5).id;
    const vil = unit(s, 'villager', 2, 18.5, 10.5).id;
    const b = battle(s);
    step(b, [attack(b, 1, [me], vil)]);
    let requestsWhileDirect = 0;
    for (let i = 0; i < 300; i++) {
      const before = b.state.nextPathRequestId;
      const directBefore = calls.length;
      step(b);
      if (calls.length > directBefore) requestsWhileDirect += b.state.nextPathRequestId - before;
      const o = get(b, me).currentOrder;
      if (o !== null && o.type === 'attack' && o.phase === 'attacking') break;
    }
    expect(calls.length).toBeGreaterThan(0);
    for (const d of calls) expect(d).toBeLessThanOrEqual(CHASE_DIRECT_DISTANCE);
    expect(requestsWhileDirect).toBe(0);
    expect(get(b, me).currentOrder).toMatchObject({ type: 'attack', phase: 'attacking' });
    run(b, 60);
    expect(get(b, vil).hp).toBeLessThan(resolved(2, 'villager').maxHp);
  });
});
