import { describe, expect, it } from 'vitest';
import { createGame } from '../../../src/sim';
import { MAP_SIZE, type ReadonlyGameState } from '../../../src/sim/types';

describe('state exposure', () => {
  it('is deeply readonly to the client (compile-time)', () => {
    const state: ReadonlyGameState = createGame({ seed: 1, mapSize: MAP_SIZE, players: [{ civ: 'byzantines' }] }).state;
    const attempt = (): void => {
      // @ts-expect-error state is readonly
      state.tick = 5;
      // @ts-expect-error nested objects are readonly
      state.players[1]!.resources.food = 1;
      // @ts-expect-error arrays are readonly
      state.entities.push(state.entities[0]!);
    };
    expect(typeof attempt).toBe('function');
  });
});
