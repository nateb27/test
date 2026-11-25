/** Research command and tech completion (incl. age advance). Owned by WP8. */

import { enqueueItem, validateProducer } from './production';
import { emit, reject, type CommandHandler } from './common';
import { recomputePopulation } from './population';
import { rebuildResolvedStats } from '../rules/stats';
import type { EntityId, PlayerId, SimContext, TechId } from '../types';

/**
 * Queue a tech at an own completed building that researches it. Rejects with
 * unknownDef, cannotPerform (building does not research it), queueFull,
 * notAvailable (reasons from `availability`) or cannotAfford.
 */
export const applyResearchCommand: CommandHandler<'research'> = (ctx, cmd) => {
  const building = validateProducer(ctx, cmd, cmd.buildingId);
  if (building === null) return;
  const def = ctx.data.def(cmd.techId);
  if (def === undefined || def.kind !== 'tech') return reject(ctx, cmd, 'unknownDef');
  if (!ctx.data.building(building.typeId).researches.includes(cmd.techId)) return reject(ctx, cmd, 'cannotPerform');
  enqueueItem(ctx, cmd, building, { kind: 'tech', techId: cmd.techId });
};

/**
 * Record a completed tech for a player: push to `researched`, rebuild the
 * player's resolved stats, apply `advancesTo`, emit ResearchCompleted (and
 * AgeAdvanced). Called by `runProduction`.
 */
export function completeResearch(ctx: SimContext, playerId: PlayerId, techId: TechId, buildingId: EntityId): void {
  const player = ctx.state.players[playerId];
  const tech = ctx.data.def(techId);
  if (player === undefined || tech === undefined || tech.kind !== 'tech') return;
  if (!player.researched.includes(techId)) player.researched.push(techId);
  rebuildResolvedStats(ctx, playerId);
  emit(ctx, { type: 'ResearchCompleted', playerId, techId, buildingId });
  if (tech.advancesTo !== undefined && tech.advancesTo > player.age) {
    player.age = tech.advancesTo;
    emit(ctx, { type: 'AgeAdvanced', playerId, age: tech.advancesTo });
  }
  recomputePopulation(ctx);
}
