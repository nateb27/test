import { describe, expect, it } from 'vitest';
import { buildEndScreen, EndWatcher } from '../../../src/client/app/endScreen';
import { createControllers } from '../../../src/client/app/controllers';
import { configFromSim } from '../../../src/client/app/screens/types';
import { aiStartsEnabled, seedIsPinned, setupDefaults } from '../../../src/client/app/seed';
import { configFromChoice, defaultColors, playAgainConfig } from '../../../src/client/app/setup';
import { createGame } from '../../../src/sim';
import { MAP_SIZE, type SimEvent } from '../../../src/sim/types';

const sim = createGame({
  seed: 9,
  mapSize: MAP_SIZE,
  players: [
    { civ: 'byzantines', color: 0x22a3a3, name: 'Me' },
    { civ: 'byzantines', controller: 'ai', difficulty: 'hard' },
  ],
});
const defeated = (playerId: number, reason: 'conquered' | 'resigned'): SimEvent => ({ type: 'PlayerDefeated', playerId, reason });
const ended = (winner: number | null): SimEvent => ({ type: 'MatchEnded', winner, tick: 10 });

describe('EndWatcher', () => {
  it('victory when the local player wins; opponentResigned when the loser resigned', () => {
    const w = new EndWatcher(1);
    expect(w.observe([defeated(2, 'resigned')], sim.state)).toBeNull();
    const vm = w.observe([ended(1)], sim.state)!;
    expect(vm.result).toBe('victory');
    expect(vm.reason).toBe('opponentResigned');
  });

  it('conquest victory', () => {
    const vm = new EndWatcher(1).observe([defeated(2, 'conquered'), ended(1)], sim.state)!;
    expect([vm.result, vm.reason]).toEqual(['victory', 'conquest']);
  });

  it('defeat by conquest, and by resigning (also without a MatchEnded: sandbox)', () => {
    const a = new EndWatcher(1).observe([defeated(1, 'conquered'), ended(2)], sim.state)!;
    expect([a.result, a.reason]).toEqual(['defeat', 'conquest']);
    const b = new EndWatcher(1).observe([defeated(1, 'resigned'), ended(2)], sim.state)!;
    expect([b.result, b.reason]).toEqual(['defeat', 'resigned']);
    const c = new EndWatcher(1).observe([defeated(1, 'resigned')], sim.state)!;
    expect([c.result, c.reason]).toEqual(['defeat', 'resigned']);
  });

  it('draw when nobody wins', () => {
    const vm = new EndWatcher(1).observe([defeated(1, 'conquered'), defeated(2, 'conquered'), ended(null)], sim.state)!;
    expect(vm.result).toBe('draw');
  });

  it('fires once', () => {
    const w = new EndWatcher(1);
    expect(w.observe([ended(1)], sim.state)).not.toBeNull();
    expect(w.observe([ended(1)], sim.state)).toBeNull();
    expect(w.observe([defeated(1, 'conquered')], sim.state)).toBeNull();
  });

  it('ignores ordinary ticks and the other player being defeated alone', () => {
    const w = new EndWatcher(1);
    expect(w.observe([], sim.state)).toBeNull();
    expect(w.observe([defeated(2, 'conquered')], sim.state)).toBeNull();
  });
});

describe('buildEndScreen', () => {
  it('lists the real players with colour, name, you flag and a copy of the stats', () => {
    const vm = buildEndScreen(sim.state, 1, 'victory', 'conquest');
    expect(vm.players.map((p) => [p.playerId, p.name, p.color, p.you])).toEqual([
      [1, 'Me', 0x22a3a3, true],
      [2, 'Computer (Hard)', 0xc62f2f, false],
    ]);
    expect(vm.players[0]!.stats).toEqual(sim.state.players[1]!.stats);
    expect(vm.players[0]!.stats).not.toBe(sim.state.players[1]!.stats);
    expect(vm.clockSeconds).toBe(0);
  });
});

describe('createControllers', () => {
  it('creates one AiPlayer per AI slot and restores from a save when there is one', () => {
    const fresh = createControllers(sim.state);
    expect(fresh.map((c) => c.playerId)).toEqual([2]);
    const save = fresh[0]!.save()!;
    expect(save).toMatchObject({ playerId: 2, kind: 'ai', difficulty: 'hard' });
    const restored = createControllers(sim.state, [{ ...save, memory: { x: 1 } }]);
    expect(restored[0]!.save()!.memory).toEqual({ x: 1 });
  });

  it('a sandbox match has no controllers', () => {
    const solo = createGame({ seed: 1, mapSize: MAP_SIZE, players: [{ civ: 'byzantines' }] });
    expect(createControllers(solo.state)).toEqual([]);
  });
});

describe('configFromSim (Restart)', () => {
  it('copies colour, controller, difficulty, name and mode and recreates the same match', () => {
    const cfg = configFromSim(sim);
    expect(cfg).toEqual({
      seed: 9,
      mapSize: MAP_SIZE,
      mode: 'conquest',
      players: [
        { civ: 'byzantines', color: 0x22a3a3, controller: 'human', name: 'Me' },
        { civ: 'byzantines', color: 0xc62f2f, controller: 'ai', difficulty: 'hard', name: 'Computer (Hard)' },
      ],
    });
    const again = createGame(cfg);
    expect(again.state.players.map((p) => [p.color, p.controller, p.difficulty, p.name])).toEqual(
      sim.state.players.map((p) => [p.color, p.controller, p.difficulty, p.name]),
    );
  });
});

describe('setup rules', () => {
  it('default colours: blue and red; a red human gets a blue opponent', () => {
    expect(defaultColors(null)).toEqual({ human: 'blue', opponent: 'red' });
    expect(defaultColors('red')).toEqual({ human: 'red', opponent: 'blue' });
    expect(defaultColors('green')).toEqual({ human: 'green', opponent: 'red' });
    expect(defaultColors('nonsense')).toEqual({ human: 'blue', opponent: 'red' });
  });

  it('configFromChoice: none gives one sandbox player, a difficulty gives an AI slot', () => {
    const base = { civ: 'byzantines', humanColor: 'red', opponentColor: 'blue', seed: 7 };
    expect(configFromChoice({ ...base, opponent: 'none' }).players).toEqual([{ civ: 'byzantines', color: 0xc62f2f, controller: 'human' }]);
    const hard = configFromChoice({ ...base, opponent: 'hard' });
    expect(hard.seed).toBe(7);
    expect(hard.players[1]).toEqual({ civ: 'byzantines', color: 0x2f6bd8, controller: 'ai', difficulty: 'hard' });
    const state = createGame(hard).state;
    expect(state.match.mode).toBe('conquest');
    expect(createGame(configFromChoice({ ...base, opponent: 'none' })).state.match.mode).toBe('sandbox');
  });

  it('Play again keeps a pinned seed and rolls a new one otherwise', () => {
    const cfg = configFromSim(sim);
    expect(playAgainConfig(cfg, true).seed).toBe(9);
    const seeds = new Set(Array.from({ length: 5 }, () => playAgainConfig(cfg, false).seed));
    expect(seeds.has(9) && seeds.size === 1).toBe(false);
    expect(playAgainConfig(cfg, false).players).toEqual(cfg.players);
  });
});

describe('URL parameters (dev and e2e builds only)', () => {
  it('?opponent sets the setup default; e2e defaults to none, dev and production to standard', () => {
    expect(setupDefaults('?opponent=hard', true, false).opponent).toBe('hard');
    expect(setupDefaults('?opponent=none', true, false).opponent).toBe('none');
    expect(setupDefaults('', true, true).opponent).toBe('none');
    expect(setupDefaults('', true, false).opponent).toBe('standard');
    expect(setupDefaults('?opponent=bogus', true, true).opponent).toBe('none');
    expect(setupDefaults('?opponent=hard&color=red', false, false)).toEqual({ opponent: 'standard', color: null });
  });

  it('?color sets the human colour', () => {
    expect(setupDefaults('?color=red', true, true).color).toBe('red');
    expect(setupDefaults('', true, true).color).toBeNull();
  });

  it('?ai=off disables the controllers; ?seed pins the seed', () => {
    expect(aiStartsEnabled('?ai=off', true)).toBe(false);
    expect(aiStartsEnabled('?ai=off', false)).toBe(true);
    expect(aiStartsEnabled('', true)).toBe(true);
    expect(seedIsPinned('?seed=5', true)).toBe(true);
    expect(seedIsPinned('?seed=5', false)).toBe(false);
    expect(seedIsPinned('', true)).toBe(false);
  });
});
