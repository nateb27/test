/** Pure rules of the match setup screen: colours, the config it produces, "Play again". */

import { MAP_SIZE, PLAYER_COLORS, type CivId, type GameConfig } from '../../sim/types';
import type { OpponentChoice } from './seed';

export interface SetupChoice {
  civ: CivId;
  opponent: OpponentChoice;
  /** `PLAYER_COLORS` ids. */
  humanColor: string;
  opponentColor: string;
  seed: number;
}

const colorValue = (id: string): number => (PLAYER_COLORS.find((c) => c.id === id) ?? PLAYER_COLORS[0]!).value;
export const isColorId = (id: string | null): id is string => id !== null && PLAYER_COLORS.some((c) => c.id === id);

/** Default colours: you blue, the opponent red; if `humanId` takes the opponent's colour the opponent gets blue. */
export function defaultColors(humanId: string | null): { human: string; opponent: string } {
  const human = isColorId(humanId) ? humanId : PLAYER_COLORS[0]!.id;
  const preferred = PLAYER_COLORS[1]!.id;
  return { human, opponent: human === preferred ? PLAYER_COLORS[0]!.id : preferred };
}

/** "No opponent" is a one-player sandbox match, exactly like Milestone 1 (apart from the colour). */
export function configFromChoice(c: SetupChoice): GameConfig {
  const human = { civ: c.civ, color: colorValue(c.humanColor), controller: 'human' as const };
  if (c.opponent === 'none') return { seed: c.seed, mapSize: MAP_SIZE, players: [human] };
  return {
    seed: c.seed,
    mapSize: MAP_SIZE,
    players: [human, { civ: c.civ, color: colorValue(c.opponentColor), controller: 'ai', difficulty: c.opponent }],
  };
}

/** A random map seed (client side only; the sim never draws from it). */
export const randomSeed = (): number => (Math.random() * 0x7fffffff) >>> 0;

/** "Play again": the same setup with a new seed unless the seed was pinned. */
export function playAgainConfig(config: GameConfig, seedPinned: boolean): GameConfig {
  return seedPinned ? config : { ...config, seed: randomSeed() };
}
