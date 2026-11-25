/**
 * The reference build order as data. Everything the bot "knows" about how to play is here or in
 * `economyBot.ts`; none of it reaches into the sim. Balance numbers belong in `src/data`, not here: these are
 * the human-style habits (how many villagers on what, when to build what).
 */

import type { ResourceType } from '../sim';

export const PLAN = {
  /** One decision per second of game time (TICK_RATE ticks). */
  decisionIntervalTicks: 20,
  /** Keep training villagers until this many exist. */
  villagerTarget: 80,
  /** Villagers queued at the Town Center at once (the one in progress plus one waiting). */
  tcQueueDepth: 2,
  /** Build a House when (cap + houses under construction * 10 - population used) drops below this. */
  houseMargin: 3,
  /** A node farther than this from every drop-off (planned ones included) wants a camp next to it. */
  campMaxDropDistance: 4.5,
  /** Farms may spend wood saved for an age building while the food stockpile is below this. */
  farmPriorityFood: 300,
  /** Villagers only work nodes within this many tiles of the Town Center. */
  workRadius: 26,
  /** A Mill for far berries only if the patch holds at least this much food. */
  millMinFood: 500,
  /** Builders sent to a House or camp, and to the large buildings. */
  houseBuilders: 2,
  campBuilders: 2,
  bigBuilders: 3,
  /** Wood below this pulls villagers onto wood. */
  woodLow: 120,
  /** Stockpile above max(this, the next age's cost + headroom) pushes villagers off that resource. */
  stockHigh: { food: 100000, wood: 450, gold: 350, stone: 250 } as Record<ResourceType, number>,
  stockHeadroom: 150,
  /** Share of the villagers that should be on each resource, by age. Farms and berries both count as food. */
  shares: {
    1: { food: 0.8, wood: 0.2, gold: 0, stone: 0 },
    2: { food: 0.6, wood: 0.28, gold: 0.12, stone: 0 },
    3: { food: 0.38, wood: 0.17, gold: 0.25, stone: 0.2 },
    4: { food: 0.38, wood: 0.17, gold: 0.25, stone: 0.2 },
  } as Record<number, Record<ResourceType, number>>,
  /** Buildings that satisfy "two distinct buildings of the current age", in the order they are built. */
  ageBuildings: {
    2: ['archeryRange', 'stable'],
    3: ['siegeWorkshop', 'silkWorkshop'],
  } as Record<number, string[]>,
  /**
   * Stop adding villagers when the advance (allowed by the rules) is within this many seconds of food income
   * of being affordable, so it goes in as soon as the food is there. Income is estimated per food gatherer.
   */
  holdSeconds: { 1: 70, 2: 30, 3: 30 } as Record<number, number>,
  foodPerGatherer: 0.28,
  /** The age's required buildings start once this share of the advance's food cost is banked. */
  ageBuildingsFoodShare: 0.4,
  /** Economy technologies: researched in this order at `building` once `villagers` of `slot` (or all) exist. */
  techs: [
    { id: 'ironAxes', building: 'lumberCamp', needs: { slot: 'wood', count: 5 } },
    { id: 'irrigation', building: 'mill', needs: { slot: 'food', count: 6 } },
    { id: 'handCarts', building: 'townCenter', needs: { slot: 'all', count: 26 } },
    { id: 'ironPicks', building: 'miningCamp', needs: { slot: 'gold', count: 6 } },
    { id: 'frameSaws', building: 'lumberCamp', needs: { slot: 'wood', count: 8 } },
    { id: 'threeFieldSystem', building: 'mill', needs: { slot: 'food', count: 10 } },
    { id: 'timberedShafts', building: 'miningCamp', needs: { slot: 'gold', count: 5 } },
    { id: 'guildCharters', building: 'townCenter', needs: { slot: 'all', count: 45 } },
  ] as { id: string; building: string; needs: { slot: ResourceType | 'all'; count: number } }[],
  /** Silk Workshops beyond the one the age needs, built when stone allows. */
  maxSilkWorkshops: 3,
} as const;
