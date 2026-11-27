/** Builds the AI controllers of a match (PLAN-M2 2.7, 7.4): fresh for a new game, restored from a save's block. */

import { AiPlayer, type Controller } from '../../bot';
import type { ControllerSave, ReadonlyGameState } from '../../sim';

/**
 * One `AiPlayer` per player whose `controller` is `'ai'`, ascending player id. A slot with a saved block is restored
 * from it (throws `SaveError('corrupt')` on bad memory); any other starts fresh, seeded from the map seed.
 */
export function createControllers(state: ReadonlyGameState, saved: readonly ControllerSave[] = []): Controller[] {
  const out: Controller[] = [];
  for (const p of state.players) {
    if (p.controller !== 'ai') continue;
    const save = saved.find((s) => s.playerId === p.id);
    out.push(save !== undefined ? AiPlayer.restore(save) : AiPlayer.create(p.id, p.difficulty ?? 'standard', state.seed));
  }
  return out;
}
