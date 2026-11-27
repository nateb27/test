/** Headless bot players. They use only the public sim API (`src/sim/index.ts`). */
export { EconomyBot, decide } from './economyBot';
export { PLAN } from './plan';
export { readView } from './view';
export type { BotView, BuildingView, NodeView, VillagerView, VillagerTask, FarmView, GatherSlot } from './view';
export type { Controller } from './controller';
export { AiPlayer } from './ai/aiPlayer';
export type { AiOptions, AiCostStats } from './ai/aiPlayer';
export type { AiMemory } from './ai/memory';
export { DIFFICULTY } from './ai/difficulty';
export type { DifficultyProfile } from './ai/difficulty';
export type { BotPlan } from './plan';
