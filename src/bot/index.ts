/** Headless bot players. They use only the public sim API (`src/sim/index.ts`). */
export { EconomyBot, decide } from './economyBot';
export { PLAN } from './plan';
export { readView } from './view';
export type { BotView, BuildingView, NodeView, VillagerView, VillagerTask, FarmView, GatherSlot } from './view';
