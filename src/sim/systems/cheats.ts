/** Cheat command (dev/test only on the client side). Owned by WP1. */

import { createUnit } from '../entities';
import { notImplemented, reject, type CommandHandler } from './common';
import { recomputePopulation } from './population';
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
    case 'spawnUnit': {
      const { width, height } = ctx.state.map;
      if (ctx.data.units.every((u) => u.id !== cheat.unitType)) {
        reject(ctx, cmd, 'unknownDef');
        return;
      }
      const tx = Math.floor(cheat.x);
      const ty = Math.floor(cheat.y);
      if (tx < 0 || ty < 0 || tx >= width || ty >= height || ctx.runtime.occupancy[ty * width + tx] !== 0) {
        reject(ctx, cmd, 'invalidTarget');
        return;
      }
      createUnit(ctx.state, cheat.unitType, cmd.playerId, cheat.x, cheat.y);
      recomputePopulation(ctx);
      return;
    }
  }
};
