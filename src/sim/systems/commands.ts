/**
 * Tick step 1: command intake. Owned by WP1, in M2 by WP20 then the orchestrator (sorting, shape validation, the
 * defeated-player rejection, dispatch). Each command's rules live in the handler's owning file.
 */

import { applyCheatCommand } from './cheats';
import { applySetStanceCommand } from './combat/stance';
import { applyCancelConstructionCommand, applyBuildCommand } from './construct';
import { applyDeleteCommand } from './cleanup';
import { reject, type CommandHandler, type CommandOf } from './common';
import { applyStopCommand } from './orders';
import { applyAttackCommand } from './orders/attack';
import { applyAttackMoveCommand } from './orders/attackMove';
import { applyAssistCommand } from './orders/build';
import { applyDropOffCommand } from './orders/dropOff';
import { applyGatherCommand } from './orders/gather';
import { applyHoldCommand } from './orders/hold';
import { applyMoveCommand } from './orders/move';
import { applyRepairCommand } from './orders/repair';
import { applyResignCommand } from './outcome';
import { applyCancelQueueCommand, applySetRallyCommand, applyTrainCommand } from './production';
import { applyResearchCommand } from './research';
import { STANCES, type Command, type CommandType, type SimContext, type Stance } from '../types';

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
  attack: applyAttackCommand, // orders/attack.ts (WP21)
  attackMove: applyAttackMoveCommand, // orders/attackMove.ts (WP21)
  hold: applyHoldCommand, // orders/hold.ts (WP21)
  setStance: applySetStanceCommand, // combat/stance.ts (WP21)
  repair: applyRepairCommand, // orders/repair.ts (WP24)
  resign: applyResignCommand, // outcome.ts (WP23)
};

/** Stable sort by (playerId, seq). */
export function sortCommands(commands: readonly Command[]): Command[] {
  return commands
    .map((cmd, index) => ({ cmd, index }))
    .sort((a, b) => a.cmd.playerId - b.cmd.playerId || a.cmd.seq - b.cmd.seq || a.index - b.index)
    .map((entry) => entry.cmd);
}

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isId(v: unknown): boolean {
  return isInt(v) && v > 0;
}

function isIdList(v: unknown): boolean {
  return Array.isArray(v) && v.length > 0 && v.every(isId);
}

/** An integer real-player id (1..n-1 with n = players.length). */
function isRealPlayer(ctx: SimContext, v: unknown): boolean {
  return isInt(v) && v >= 1 && v < ctx.state.players.length;
}

function isCheatShapeValid(ctx: SimContext, cheat: unknown): boolean {
  if (cheat === null || typeof cheat !== 'object') return false;
  const c = cheat as Record<string, unknown>;
  switch (c.kind) {
    case 'addResources':
      return (
        c.amounts !== null &&
        typeof c.amounts === 'object' &&
        Object.values(c.amounts as Record<string, unknown>).every(isNum)
      );
    case 'instantBuild':
    case 'instantResearch':
      return typeof c.enabled === 'boolean';
    case 'spawnUnit':
      return (
        typeof c.unitType === 'string' && isNum(c.x) && isNum(c.y) && (c.owner === undefined || isRealPlayer(ctx, c.owner))
      );
    case 'setHp':
      return isId(c.entityId) && isNum(c.hp);
    case 'defeat':
      return isRealPlayer(ctx, c.playerId);
    default:
      return false;
  }
}

/**
 * Shape validation (not rule validation): known type, real player, integer
 * seq, finite numbers, non-empty id lists, strings where ids are expected.
 * Rules (ownership, affordability, ...) are checked by each handler.
 */
export function isCommandShapeValid(ctx: SimContext, cmd: Command): boolean {
  if (cmd === null || typeof cmd !== 'object') return false;
  const c = cmd as unknown as Record<string, unknown>;
  if (typeof c.type !== 'string' || !Object.prototype.hasOwnProperty.call(commandHandlers, c.type)) return false;
  if (!isInt(c.playerId) || c.playerId < 1 || c.playerId >= ctx.state.players.length) return false;
  if (!isInt(c.seq)) return false;
  switch (cmd.type) {
    case 'move':
      return isIdList(c.unitIds) && isNum(c.x) && isNum(c.y) && typeof c.queue === 'boolean';
    case 'gather':
      return isIdList(c.unitIds) && isId(c.nodeId) && typeof c.queue === 'boolean';
    case 'build':
      return (
        isIdList(c.unitIds) &&
        typeof c.buildingType === 'string' &&
        isInt(c.tx) &&
        isInt(c.ty) &&
        typeof c.queue === 'boolean'
      );
    case 'assist':
      return isIdList(c.unitIds) && isId(c.buildingId) && typeof c.queue === 'boolean';
    case 'dropOff':
      return isIdList(c.unitIds) && isId(c.buildingId);
    case 'stop':
      return isIdList(c.unitIds);
    case 'train':
      return isId(c.buildingId) && typeof c.unitType === 'string';
    case 'research':
      return isId(c.buildingId) && typeof c.techId === 'string';
    case 'cancelQueue':
      return isId(c.buildingId) && isInt(c.index);
    case 'cancelConstruction':
      return isId(c.buildingId);
    case 'setRally':
      return (
        isIdList(c.buildingIds) && isNum(c.x) && isNum(c.y) && (c.targetId === undefined || isId(c.targetId))
      );
    case 'delete':
      return isIdList(c.entityIds);
    case 'cheat':
      return isCheatShapeValid(ctx, c.cheat);
    case 'attack':
      return isIdList(c.unitIds) && isId(c.targetId) && typeof c.queue === 'boolean';
    case 'attackMove':
      return isIdList(c.unitIds) && isNum(c.x) && isNum(c.y) && typeof c.queue === 'boolean';
    case 'hold':
      return isIdList(c.unitIds);
    case 'setStance':
      return isIdList(c.unitIds) && STANCES.includes(c.stance as Stance);
    case 'repair':
      return isIdList(c.unitIds) && isId(c.buildingId) && typeof c.queue === 'boolean';
    case 'resign':
      return true;
  }
}

/**
 * Apply the tick's commands in (playerId, seq) order. A command that fails
 * shape validation is dropped with CommandRejected('invalidCommand'); a command
 * (other than `cheat`) from a defeated player is dropped with
 * CommandRejected('playerDefeated'); the rest are dispatched through
 * `commandHandlers`. The winner (`outcome: 'won'`) keeps playing.
 */
export function applyCommands(ctx: SimContext, commands: readonly Command[]): void {
  for (const cmd of sortCommands(commands)) {
    if (!isCommandShapeValid(ctx, cmd)) {
      reject(ctx, cmd, 'invalidCommand');
      continue;
    }
    if (cmd.type !== 'cheat' && ctx.state.players[cmd.playerId]?.outcome === 'defeated') {
      reject(ctx, cmd, 'playerDefeated');
      continue;
    }
    const handler = commandHandlers[cmd.type] as (ctx: SimContext, cmd: CommandOf<CommandType>) => void;
    handler(ctx, cmd);
  }
}
