/**
 * `__game.startBattle` scene (dev and e2e builds): the performance battle of PLAN-M2 8.4, built by WP33's
 * `createBattleScenario` (both bases with 30 buildings each, two armies of the 8.4 mix in lines 14 tiles apart at the
 * map centre, already told to attack-move at each other). The returned sim is at tick 1. Loaded lazily by the hook, so
 * the scenario code stays out of the production bundle.
 */

import { createBattleScenario } from '../../sim/stress';
import type { Sim } from '../../sim/types';

export function createBattleSim(seed = 1, perSide = 200): Sim {
  return createBattleScenario(seed, perSide);
}
