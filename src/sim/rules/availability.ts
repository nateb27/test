/** Availability rules (plan 4.7). Owned by WP8. */

import type { Availability, PlayerId, ProducibleId, ResourceAmounts, SimContext } from '../types';

const ZERO: ResourceAmounts = { food: 0, wood: 0, gold: 0, stone: 0 };

/**
 * Whether `defId` (unit, building or tech) is available to the player: age,
 * requiresBuildings, requiresTechs, civs, replaces, buildLimit, already
 * researched / in progress, age-advance building count; plus resolved cost and
 * affordability. The sim's validation and the HUD both call this.
 * STUB: everything unavailable with no reasons.
 */
export function availability(_ctx: SimContext, _playerId: PlayerId, _defId: ProducibleId): Availability {
  return {
    available: false,
    hidden: false,
    reasons: [],
    cost: { ...ZERO },
    affordable: true,
    shortfall: { ...ZERO },
  };
}
