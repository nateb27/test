/** Research command and tech completion (incl. age advance). Owned by WP8. */

import { notImplemented, type CommandHandler } from './common';
import type { EntityId, PlayerId, SimContext, TechId } from '../types';

/** STUB: rejects. */
export const applyResearchCommand: CommandHandler<'research'> = (ctx, cmd) => notImplemented(ctx, cmd);

/**
 * Record a completed tech for a player: push to `researched`, rebuild the
 * player's resolved stats, apply `advancesTo`, emit ResearchCompleted (and
 * AgeAdvanced). Called by `runProduction`. STUB: does nothing.
 */
export function completeResearch(
  _ctx: SimContext,
  _playerId: PlayerId,
  _techId: TechId,
  _buildingId: EntityId,
): void {
  // Implemented by WP8.
}
