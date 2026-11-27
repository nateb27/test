/** Cheat command (dev/test only on the client side). Owned by WP20 in M2, then the orchestrator. */

import { createUnit, findEntity } from '../entities';
import { buildingCombat, unitCombat } from './combat/damage';
import { emit, notImplemented, reject, type CommandHandler } from './common';
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
      const owner = cheat.owner ?? cmd.playerId;
      createUnit(ctx.state, cheat.unitType, owner, cheat.x, cheat.y, 1, unitCombat(ctx, owner, cheat.unitType).maxHp);
      recomputePopulation(ctx);
      return;
    }
    case 'setHp': {
      // Any owner's unit or building (tests damage enemies this way); nodes have no hp. 0 kills it in step 11.
      const e = findEntity(ctx.state, cheat.entityId);
      if (e === undefined) return reject(ctx, cmd, 'unknownEntity');
      if (e.kind === 'node') return reject(ctx, cmd, 'invalidTarget');
      const max = e.kind === 'unit' ? unitCombat(ctx, e.owner, e.typeId).maxHp : buildingCombat(ctx, e.owner, e.typeId).maxHp;
      e.hp = Math.min(max, Math.max(0, Math.round(cheat.hp)));
      return;
    }
    case 'defeat': {
      // As if conquered: the outcome step (WP23) destroys the player's entities and decides the match.
      const target = ctx.state.players[cheat.playerId];
      if (target === undefined || target.outcome !== 'playing') return reject(ctx, cmd, 'invalidTarget');
      target.outcome = 'defeated';
      target.defeatedTick = ctx.state.tick + 1;
      emit(ctx, { type: 'PlayerDefeated', playerId: cheat.playerId, reason: 'conquered' });
      return;
    }
  }
};
