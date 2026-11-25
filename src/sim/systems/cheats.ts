/** Cheat command (dev/test only on the client side). Owned by WP1. */

import { notImplemented, type CommandHandler } from './common';
import { RESOURCE_TYPES } from '../types';

export const applyCheatCommand: CommandHandler<'cheat'> = (ctx, cmd) => {
  const player = ctx.state.players[cmd.playerId];
  if (player === undefined || cmd.playerId === 0) {
    notImplemented(ctx, cmd);
    return;
  }
  const cheat = cmd.cheat;
  switch (cheat.kind) {
    case 'addResources':
      for (const r of RESOURCE_TYPES) {
        const add = cheat.amounts[r] ?? 0;
        if (Number.isFinite(add)) player.resources[r] = Math.max(0, player.resources[r] + Math.trunc(add));
      }
      return;
    case 'instantBuild':
      player.cheats.instantBuild = cheat.enabled;
      return;
    case 'instantResearch':
      player.cheats.instantResearch = cheat.enabled;
      return;
    case 'spawnUnit':
      // TODO(WP1): create the unit at (x, y) for the player.
      notImplemented(ctx, cmd);
      return;
  }
};
