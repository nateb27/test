import type { Controller } from '../../../bot';
import type { CivId, GameConfig, Sim } from '../../../sim/types';

/** Where the loading screen gets the match from. */
export type LoadSource =
  /** Generate a new match from a config. */
  | { kind: 'new'; config: GameConfig }
  /** Use an already built sim (a loaded save). */
  | { kind: 'sim'; sim: Sim };

/** Router state. Each screen's data travels with it. */
export type Screen =
  | { name: 'menu' }
  | { name: 'setup' }
  | { name: 'loading'; source: LoadSource }
  /** `config` is the config the match was created from (null for a loaded save), used by Restart. */
  | { name: 'game'; sim: Sim; civ: CivId; config: GameConfig | null; controllers: Controller[] };

export type Navigate = (screen: Screen) => void;

/**
 * The config that recreates a running sim's match from scratch (Restart on a loaded save): civ, colour, controller,
 * difficulty and name come from `PlayerState`, the mode from the match.
 */
export function configFromSim(sim: Sim): GameConfig {
  const players = sim.state.players.slice(1).map((p) => ({
    civ: p.civ ?? 'byzantines',
    color: p.color,
    controller: p.controller === 'ai' ? ('ai' as const) : ('human' as const),
    ...(p.controller === 'ai' && p.difficulty !== null ? { difficulty: p.difficulty } : {}),
    name: p.name,
  }));
  return { seed: sim.state.seed, mapSize: sim.state.map.width, players, mode: sim.state.match.mode };
}
