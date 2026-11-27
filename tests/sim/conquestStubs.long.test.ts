/**
 * `npm run test:long` (PLAN-M2 8.1): long-running sim tests, excluded from `npm test`.
 *
 * Phase 0 seed of the suite: a 2-player conquest match driven by two economy bots for 30,000 ticks (25 minutes) runs
 * identically twice and through save/load. WP26/WP32 add the AI ladder and WP33 the conquest replay here.
 */

import { describe, expect, it } from 'vitest';
import { EconomyBot } from '../../src/bot';
import { createGame, deserialize, hashState, serialize, type Command, type GameConfig, type Sim } from '../../src/sim';

const CONFIG: GameConfig = { seed: 21, mapSize: 120, players: [{ civ: 'byzantines' }, { civ: 'byzantines' }] };
const TICKS = 30_000;

function play(saveEvery: number | null): string[] {
  let sim: Sim = createGame(CONFIG);
  const bots = [new EconomyBot(1), new EconomyBot(2)];
  const hashes: string[] = [];
  for (let t = 0; t < TICKS; t++) {
    const cmds: Command[] = [];
    for (const b of bots) cmds.push(...b.update(sim));
    sim.step(cmds);
    if (saveEvery !== null && t % saveEvery === saveEvery - 1) sim = deserialize(serialize(sim));
    if (t % 1000 === 999) hashes.push(hashState(sim.state));
  }
  return hashes;
}

describe('2-player match with economy bots (combat stubs)', () => {
  it('30,000 ticks: two runs and a run with save/load every 2,500 ticks agree', () => {
    const a = play(null);
    expect(play(null)).toEqual(a);
    expect(play(2500)).toEqual(a);
  });
});
