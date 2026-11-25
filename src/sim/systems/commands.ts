/**
 * Tick step 1: command intake. Owned by WP1 (sorting, shape validation,
 * dispatch). Each command's rules live in the handler's owning file.
 */

import { applyCheatCommand } from './cheats';
import { applyCancelConstructionCommand, applyBuildCommand } from './construct';
import { applyDeleteCommand } from './cleanup';
import type { CommandHandler, CommandOf } from './common';
import { applyStopCommand } from './orders';
import { applyAssistCommand } from './orders/build';
import { applyDropOffCommand } from './orders/dropOff';
import { applyGatherCommand } from './orders/gather';
import { applyMoveCommand } from './orders/move';
import { applyCancelQueueCommand, applySetRallyCommand, applyTrainCommand } from './production';
import { applyResearchCommand } from './research';
import type { Command, CommandType, SimContext } from '../types';

type HandlerTable = { [T in CommandType]: CommandHandler<T> };

/** Which function applies each command type, and which work package owns it. */
export const commandHandlers: HandlerTable = {
  move: applyMoveCommand, // orders/move.ts (WP2)
  stop: applyStopCommand, // orders/index.ts (WP2)
  gather: applyGatherCommand, // orders/gather.ts (WP6)
  dropOff: applyDropOffCommand, // orders/dropOff.ts (WP6)
  build: applyBuildCommand, // construct.ts (WP7)
  assist: applyAssistCommand, // orders/build.ts (WP7)
  cancelConstruction: applyCancelConstructionCommand, // construct.ts (WP7)
  train: applyTrainCommand, // production.ts (WP8)
  research: applyResearchCommand, // research.ts (WP8)
  cancelQueue: applyCancelQueueCommand, // production.ts (WP8)
  setRally: applySetRallyCommand, // production.ts (WP8)
  delete: applyDeleteCommand, // cleanup.ts (WP1)
  cheat: applyCheatCommand, // cheats.ts (WP1)
};

/** Stable sort by (playerId, seq). */
export function sortCommands(commands: readonly Command[]): Command[] {
  return commands
    .map((cmd, index) => ({ cmd, index }))
    .sort((a, b) => a.cmd.playerId - b.cmd.playerId || a.cmd.seq - b.cmd.seq || a.index - b.index)
    .map((entry) => entry.cmd);
}

/**
 * Apply the tick's commands in (playerId, seq) order.
 * TODO(WP1): shape validation (finite numbers, known type, non-empty id lists,
 * valid playerId) rejecting with 'invalidCommand' before dispatch.
 */
export function applyCommands(ctx: SimContext, commands: readonly Command[]): void {
  for (const cmd of sortCommands(commands)) {
    const handler = commandHandlers[cmd.type] as (ctx: SimContext, cmd: CommandOf<CommandType>) => void;
    handler(ctx, cmd);
  }
}
