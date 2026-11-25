import type { CivId, GameConfig, Sim } from '../../../sim/types';

/** Router state. Each screen's data travels with it. */
export type Screen =
  | { name: 'menu' }
  | { name: 'civSelect' }
  | { name: 'loading'; config: GameConfig }
  | { name: 'game'; sim: Sim; civ: CivId };

export type Navigate = (screen: Screen) => void;
