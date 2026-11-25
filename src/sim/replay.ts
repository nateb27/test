/**
 * Replay utility (plan 9.1): seed + command log in, final state out. Owned by WP12.
 *
 * A match is fully determined by its `GameConfig` and the commands handed to
 * `sim.step` on each tick, so a log of `{ tick, commands }` entries is a
 * complete recording. `replay` rebuilds the match and plays the log back,
 * optionally hashing the state on a schedule and round-tripping the whole
 * state through `serialize`/`deserialize` at chosen ticks (a save taken there
 * must continue exactly like the unbroken run).
 */

import { registry } from '../data/index';
import type { DataRegistry } from '../data/schema';
import { hashState } from './hash';
import { deserialize, serialize } from './serialize';
import { createGame } from './sim';
import type { Command, GameConfig, Sim, SimEvent } from './types';

/** Commands handed to `step` when `state.tick` equals `tick` (so they apply during that tick). */
export interface CommandLogEntry {
  tick: number;
  commands: Command[];
}

/** Entries in ascending tick order, at most one per tick, never empty `commands`. */
export type CommandLog = CommandLogEntry[];

export interface ReplayOptions {
  /** Record `hashState` every this many ticks (and at the end). 0 or omitted: only at the end. */
  hashEvery?: number;
  /** Ticks (value of `state.tick`) at which to replace the sim by `deserialize(serialize(sim))`. */
  saveLoadAt?: readonly number[];
  /** Registry to play with. Defaults to the real content. */
  data?: DataRegistry;
  /** Called after every tick with that tick's events. */
  onEvents?: (events: readonly SimEvent[], tick: number) => void;
}

export interface ReplayResult {
  /** The sim after the last tick. */
  sim: Sim;
  /** `[tick, hash]` pairs, ascending, taken after the tick counter reached `tick`. */
  hashes: [tick: number, hash: string][];
  /** `hashState` of the final state. */
  finalHash: string;
}

/**
 * Create the match from `config` and play `ticks` ticks, feeding each log
 * entry to the step it was recorded on. Returns the final sim and the hashes.
 */
export function replay(config: GameConfig, log: Readonly<CommandLog>, ticks: number, options: ReplayOptions = {}): ReplayResult {
  const data = options.data ?? registry;
  const every = options.hashEvery ?? 0;
  const saveAt = new Set(options.saveLoadAt ?? []);
  let sim = createGame(config, data);
  const hashes: [number, string][] = [];
  let next = 0;
  for (let t = 0; t < ticks; t++) {
    if (saveAt.has(t)) sim = deserialize(serialize(sim), data);
    while (next < log.length && (log[next] as CommandLogEntry).tick < t) next++;
    const entry = log[next];
    const commands = entry !== undefined && entry.tick === t ? entry.commands : [];
    const events = sim.step(commands);
    options.onEvents?.(events, t);
    const done = t + 1;
    if (every > 0 && done % every === 0) hashes.push([done, hashState(sim.state)]);
  }
  const finalHash = hashState(sim.state);
  if (hashes.length === 0 || (hashes[hashes.length - 1] as [number, string])[0] !== ticks) hashes.push([ticks, finalHash]);
  return { sim, hashes, finalHash };
}

/** Collects the commands of a live run into a `CommandLog`. */
export class CommandRecorder {
  readonly log: CommandLog = [];

  /** Record the commands about to be stepped at `tick` (`state.tick` before the step). */
  record(tick: number, commands: readonly Command[]): void {
    if (commands.length === 0) return;
    this.log.push({ tick, commands: commands.map((c) => ({ ...c })) });
  }
}

/** JSON text of a log (plain data, stable across runs). */
export function commandLogToJson(log: Readonly<CommandLog>): string {
  return JSON.stringify(log);
}

/** Parse `commandLogToJson` output. Throws on anything that is not a log. */
export function commandLogFromJson(json: string): CommandLog {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) throw new Error('Not a command log');
  let last = -1;
  for (const entry of parsed as unknown[]) {
    const e = entry as Partial<CommandLogEntry> | null;
    if (e === null || typeof e !== 'object' || !Number.isInteger(e.tick) || !Array.isArray(e.commands)) {
      throw new Error('Not a command log');
    }
    if ((e.tick as number) <= last) throw new Error('Command log ticks must be strictly ascending');
    last = e.tick as number;
  }
  return parsed as CommandLog;
}
