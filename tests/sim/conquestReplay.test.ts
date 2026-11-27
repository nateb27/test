/**
 * WP33: conquest replay, bounded for `npm test` (the full 30,000-tick version is `conquestReplay.long.test.ts`). Two
 * AIs play 6,000 ticks (past the first waves of Hard); the recorded commands replay hash for hash every 100 ticks
 * without the AIs, and a live run saved and loaded (state and controllers) at 4 seeded ticks equals the uninterrupted
 * one.
 */

import { describe, expect, it } from 'vitest';
import { replay } from '../../src/sim';
import { HASH_EVERY, conquestConfig, playConquest, seededTicks } from './conquestReplay';

describe('conquest replay (two AIs, 6,000 ticks)', () => {
  it('replay and save/load agree with the live run every 100 ticks', () => {
    const config = conquestConfig(3, 'hard', 'standard');
    const live = playConquest(config, 6000);
    expect(live.hashes.length).toBe(60);
    expect(replay(config, live.log, live.ticks, { hashEvery: HASH_EVERY }).hashes).toEqual(live.hashes);
    expect(playConquest(config, live.ticks, seededTicks(7, live.ticks, 4)).hashes).toEqual(live.hashes);
  });
});
