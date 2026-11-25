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
  | { name: 'civSelect' }
  | { name: 'loading'; source: LoadSource }
  /** `config` is the config the match was created from (null for a loaded save), used by Restart. */
  | { name: 'game'; sim: Sim; civ: CivId; config: GameConfig | null };

export type Navigate = (screen: Screen) => void;

/** The config that recreates a running sim's match from scratch (Restart on a loaded save). */
export function configFromSim(sim: Sim): GameConfig {
  const players = sim.state.players.slice(1).map((p) => ({ civ: p.civ ?? 'byzantines' }));
  return { seed: sim.state.seed, mapSize: sim.state.map.width, players };
}
