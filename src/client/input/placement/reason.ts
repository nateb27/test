/** Human-readable reason a placement is invalid (pure). */

import type { PlacementResult, ResourceAmounts, UnavailableReason } from '../../../sim/types';

const RESOURCES: (keyof ResourceAmounts)[] = ['food', 'wood', 'gold', 'stone'];

function unavailable(r: UnavailableReason): string {
  switch (r.code) {
    case 'requiresAge':
      return `Requires age ${r.age}`;
    case 'requiresBuilding':
      return 'Requires another building';
    case 'requiresTech':
      return 'Requires a technology';
    case 'buildLimit':
      return `Limit of ${r.limit} reached`;
    case 'wrongCiv':
    case 'replaced':
      return 'Not available to your civilization';
    default:
      return 'Not available';
  }
}

/** Why `result` is not ok, or null when it is ok. Terrain problems come before rules, rules before cost. */
export function describePlacementProblem(result: PlacementResult): string | null {
  if (result.ok) return null;
  const problems = result.tiles.filter((t) => t !== null);
  if (problems.includes('outOfBounds')) return 'Outside the map';
  if (problems.includes('occupied')) return 'Blocked';
  if (problems.includes('notBuildable')) return 'Cannot build on this terrain';
  const a = result.availability;
  const first = a.reasons[0];
  if (first !== undefined) return unavailable(first);
  if (!a.affordable) {
    const short = RESOURCES.find((k) => a.shortfall[k] > 0);
    return short === undefined ? 'Not enough resources' : `Not enough ${short}`;
  }
  return 'Cannot build here';
}
