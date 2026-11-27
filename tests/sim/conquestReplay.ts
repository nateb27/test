/**
 * Conquest replay (PLAN-M2 8.1 "Determinism", WP33): a match between two AIs is played live while its commands are
 * recorded; `replay` must rebuild it hash for hash without any AI, and a live run whose state and controllers are saved
 * and loaded at seeded ticks must equal the uninterrupted one.
 */

import { AiPlayer } from '../../src/bot';
import {
  CommandRecorder,
  createGame,
  createRng,
  deserializeSave,
  hashState,
  rngInt,
  serialize,
  type Command,
  type CommandLog,
  type GameConfig,
  type Sim,
} from '../../src/sim';
import type { AiDifficulty } from '../../src/sim/types';

export const HASH_EVERY = 100;

export function conquestConfig(seed: number, d1: AiDifficulty, d2: AiDifficulty): GameConfig {
  return {
    seed,
    mapSize: 120,
    players: [
      { civ: 'byzantines', controller: 'ai', difficulty: d1 },
      { civ: 'byzantines', controller: 'ai', difficulty: d2 },
    ],
  };
}

export interface LiveRun {
  config: GameConfig;
  log: CommandLog;
  /** `[tick, hash]` every HASH_EVERY ticks and at the end. */
  hashes: [number, string][];
  ticks: number;
  winner: number | null;
  commands: number;
}

/**
 * Play the AIs for `ticks` ticks (stopping at the first multiple of HASH_EVERY after the match ends), recording every
 * command. With `saveLoadAt`, state and controllers go through `serialize`/`deserializeSave` before those ticks.
 */
export function playConquest(config: GameConfig, ticks: number, saveLoadAt: readonly number[] = []): LiveRun {
  let sim: Sim = createGame(config);
  let ais = config.players.map((p, i) => AiPlayer.create(i + 1, p.difficulty ?? 'standard', config.seed));
  const recorder = new CommandRecorder();
  const hashes: [number, string][] = [];
  const saves = new Set(saveLoadAt);
  let commands = 0;
  while (sim.state.tick < ticks) {
    const t = sim.state.tick;
    if (saves.has(t)) {
      const loaded = deserializeSave(serialize(sim, ais.map((a) => a.save())));
      sim = loaded.sim;
      ais = loaded.controllers.map((c) => AiPlayer.restore(c));
    }
    const cmds: Command[] = [];
    for (const ai of ais) cmds.push(...ai.update(sim));
    recorder.record(t, cmds);
    commands += cmds.length;
    sim.step(cmds);
    if (sim.state.tick % HASH_EVERY === 0) {
      hashes.push([sim.state.tick, hashState(sim.state)]);
      if (sim.state.match.winner !== null) break;
    }
  }
  return { config, log: recorder.log, hashes, ticks: sim.state.tick, winner: sim.state.match.winner, commands };
}

/** `count` distinct seeded ticks in [1, ticks). */
export function seededTicks(seed: number, ticks: number, count: number): number[] {
  const rng = createRng(seed);
  const out = new Set<number>();
  while (out.size < count) out.add(1 + rngInt(rng, ticks - 1));
  return [...out].sort((a, b) => a - b);
}
