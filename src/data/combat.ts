import type { CombatRules } from './schema';

/** Engine-wide combat tunables (PLAN-M2 3.7). Balance numbers live here, not in the sim. */
export const combat: CombatRules = {
  reach: 0.75,
  meleeReleaseSlack: 0.5,
  minDamage: 1,
  leashRadius: 10,
  retaliateRadius: 10,
  projectileSpeed: { arrow: 9, stone: 6, fire: 8 },
  constructionStartPercent: 10,
  repairRateFactor: 0.25,
  repairMinHpPerSecond: 2,
  repairCostPercent: 50,
};
