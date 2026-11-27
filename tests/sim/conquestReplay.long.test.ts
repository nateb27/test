/**
 * WP33, `npm run test:long`: conquest replay at full length (PLAN-M2 8.1): two AIs, up to 30,000 ticks (or the end of
 * the match); two replays of the recorded commands match the live run every 100 ticks; a live run saved and loaded
 * (state and controllers) at 10 seeded ticks equals the uninterrupted one; a replay with state save/loads at the same
 * ticks does too.
 */

import { describe, expect, it } from 'vitest';
import { replay } from '../../src/sim';
import { HASH_EVERY, conquestConfig, playConquest, seededTicks } from './conquestReplay';

const TICKS = 30_000;

describe('conquest replay (two AIs, 30,000 ticks)', () => {
  it.each([
    [1, 'hard', 'easy'],
    [2, 'standard', 'hard'],
  ] as const)('seed %i, %s vs %s: replays and save/load agree every 100 ticks', (seed, d1, d2) => {
    const config = conquestConfig(seed, d1, d2);
    const live = playConquest(config, TICKS);
    // The AIs really played (a replay of nothing would match trivially): about 30 commands a minute between them (725
    // and 736 commands in these 25 minutes; the AIs re-issue an order only when it changes something, which is why the
    // original bound of 1,000 could not hold in 30,000 ticks), and each built, trained, gathered and fought.
    expect(live.commands, 'the AIs played').toBeGreaterThan(500);
    for (const p of [1, 2]) {
      const types = new Set(live.log.flatMap((e) => e.commands.filter((c) => c.playerId === p).map((c) => c.type)));
      for (const t of ['build', 'train', 'gather']) expect(types.has(t as never), `player ${p} ${t}`).toBe(true);
      expect(types.has('attack') || types.has('attackMove'), `player ${p} fought`).toBe(true);
    }
    const r1 = replay(config, live.log, live.ticks, { hashEvery: HASH_EVERY });
    const r2 = replay(config, live.log, live.ticks, { hashEvery: HASH_EVERY });
    expect(r1.hashes).toEqual(live.hashes);
    expect(r2.hashes).toEqual(live.hashes);
    const at = seededTicks(seed * 101, live.ticks, 10);
    expect(playConquest(config, live.ticks, at).hashes).toEqual(live.hashes);
    expect(replay(config, live.log, live.ticks, { hashEvery: HASH_EVERY, saveLoadAt: at }).hashes).toEqual(live.hashes);
  }, 1_800_000);
});
