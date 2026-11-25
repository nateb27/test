import { describe, expect, it } from 'vitest';
import { createGame, deserialize, hashState, serialize } from '../../src/sim';
import { MAP_SIZE, NEUTRAL_PLAYER_ID, SAVE_VERSION } from '../../src/sim/types';

const config = { seed: 1234, mapSize: MAP_SIZE, players: [{ civ: 'byzantines' }] };

describe('sim stub', () => {
  it('creates a valid initial state', () => {
    const sim = createGame(config);
    const s = sim.state;
    expect(s.tick).toBe(0);
    expect(s.map.width).toBe(MAP_SIZE);
    expect(s.map.tiles).toHaveLength(MAP_SIZE * MAP_SIZE);
    expect(s.map.tiles.every((t) => t === 'grass')).toBe(true);
    expect(s.players).toHaveLength(2);
    expect(s.players[0]?.id).toBe(NEUTRAL_PLAYER_ID);
    expect(s.players[0]?.civ).toBeNull();
    expect(s.players[1]?.civ).toBe('byzantines');
    expect(s.players[1]?.resources).toEqual({ food: 200, wood: 200, gold: 100, stone: 0 });
    expect(s.objectives.entries).toHaveLength(1);
  });

  it('increments the tick on step', () => {
    const sim = createGame(config);
    expect(sim.step([])).toEqual([]);
    sim.step([]);
    expect(sim.state.tick).toBe(2);
  });

  it('is deterministic: same seed, same hashes', () => {
    const a = createGame(config);
    const b = createGame(config);
    for (let i = 0; i < 50; i++) {
      a.step([]);
      b.step([]);
    }
    expect(hashState(a.state)).toBe(hashState(b.state));
    expect(hashState(a.state)).toMatch(/^[0-9a-f]{8}$/);
    expect(hashState(createGame({ ...config, seed: 99 }).state)).not.toBe(hashState(createGame(config).state));
  });

  it('serializes canonically and round-trips', () => {
    const sim = createGame(config);
    for (let i = 0; i < 10; i++) sim.step([]);
    const json = serialize(sim);
    expect(JSON.parse(json).version).toBe(SAVE_VERSION);
    const loaded = deserialize(json);
    expect(hashState(loaded.state)).toBe(hashState(sim.state));
    expect(serialize(loaded)).toBe(json);
    // Continuing after load matches continuing without.
    for (let i = 0; i < 10; i++) {
      sim.step([]);
      loaded.step([]);
    }
    expect(hashState(loaded.state)).toBe(hashState(sim.state));
  });

  it('refuses unknown save versions', () => {
    const json = serialize(createGame(config)).replace(`"version":${SAVE_VERSION}`, '"version":999');
    expect(() => deserialize(json)).toThrow(/Unsupported save version/);
  });

  it('applies cheat commands and rejects unimplemented commands with an event', () => {
    const sim = createGame(config);
    const events = sim.step([
      { type: 'cheat', playerId: 1, seq: 2, cheat: { kind: 'addResources', amounts: { stone: 500 } } },
      { type: 'stop', playerId: 1, seq: 1, unitIds: [999] },
    ]);
    expect(sim.state.players[1]?.resources.stone).toBe(500);
    expect(events).toEqual([
      { type: 'CommandRejected', playerId: 1, seq: 1, commandType: 'stop', reason: 'notOwner' },
    ]);
  });
});
