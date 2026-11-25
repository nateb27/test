import type { StartingConditions } from './schema';

/** Match start conditions (plan 4.2). */
export const start: StartingConditions = {
  resources: { food: 200, wood: 200, gold: 100, stone: 0 },
  centerBuilding: 'townCenter',
  units: [{ unitType: 'villager', count: 6 }],
};
