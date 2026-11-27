/**
 * Outcome (PLAN-M2 4.13): tick step 12 (before objectives) and the `resign` command. Owned by WP23.
 */

import { emit, reject, type CommandHandler } from './common';
import { NEUTRAL_PLAYER_ID, type PlayerId, type SimContext } from '../types';

/** True when the player can still train units or build a Town Center (the conquest survival test, 4.13). */
function playerSurvives(ctx: SimContext, playerId: PlayerId): boolean {
  const centre = ctx.data.start.centerBuilding;
  for (const e of ctx.state.entities) {
    if (e.owner !== playerId || e.kind === 'node' || e.hp <= 0) continue;
    if (e.kind === 'building') {
      if (e.constructed && ctx.data.building(e.typeId).trains.length > 0) return true;
    } else if (ctx.data.unit(e.typeId).builds?.includes(centre) === true) {
      return true;
    }
  }
  return false;
}

/**
 * Step 12 (conquest mode only): defeat checks for `playing` players, destruction of defeated players' entities
 * (`hp = 0`, they die in step 11 of the next tick), victory or draw (`match.winner`, `endedTick`, `MatchEnded`,
 * `ObjectiveCompleted('conquest:<id>')`, the latter emitted by `runObjectives`).
 *
 * Defeated players' entities are zeroed in every mode and every tick (idempotent), so a defeat from the `defeat`
 * cheat or `resign` is handled like a conquest. The kill credit of such deaths is null (`lastAttackerId` reset).
 */
export function runOutcome(ctx: SimContext): void {
  const { state } = ctx;
  const conquest = state.match.mode === 'conquest';
  const tickAfter = state.tick + 1;

  if (conquest) {
    for (const p of state.players) {
      if (p.id === NEUTRAL_PLAYER_ID || p.outcome !== 'playing') continue;
      if (playerSurvives(ctx, p.id)) continue;
      p.outcome = 'defeated';
      p.defeatedTick = tickAfter;
      emit(ctx, { type: 'PlayerDefeated', playerId: p.id, reason: 'conquered' });
    }
  }

  for (const e of state.entities) {
    if (e.kind === 'node' || e.hp <= 0) continue;
    if (state.players[e.owner]?.outcome !== 'defeated') continue;
    e.hp = 0;
    e.lastAttackerId = null;
  }

  if (!conquest || state.match.endedTick !== null) return;
  let playing = 0;
  let last: PlayerId | null = null;
  let real = 0;
  for (const p of state.players) {
    if (p.id === NEUTRAL_PLAYER_ID) continue;
    real++;
    if (p.outcome === 'playing') {
      playing++;
      last = p.id;
    }
  }
  if (real < 2) return; // a single-player "conquest" never ends
  if (playing === 1 && last !== null) {
    const winner = state.players[last];
    if (winner === undefined) return;
    winner.outcome = 'won';
    state.match.winner = last;
    state.match.endedTick = tickAfter;
    emit(ctx, { type: 'MatchEnded', winner: last, tick: tickAfter });
  } else if (playing === 0) {
    state.match.winner = null;
    state.match.endedTick = tickAfter;
    emit(ctx, { type: 'MatchEnded', winner: null, tick: tickAfter });
  }
}

/**
 * Resign: accepted while the player is `playing` (else `playerDefeated`); sets `outcome = 'defeated'`,
 * `defeatedTick = tick + 1` and emits `PlayerDefeated{reason: 'resigned'}` at once; destruction happens in step 12.
 */
export const applyResignCommand: CommandHandler<'resign'> = (ctx, cmd) => {
  const player = ctx.state.players[cmd.playerId];
  if (player === undefined || player.outcome !== 'playing') return reject(ctx, cmd, 'playerDefeated');
  player.outcome = 'defeated';
  player.defeatedTick = ctx.state.tick + 1;
  emit(ctx, { type: 'PlayerDefeated', playerId: cmd.playerId, reason: 'resigned' });
};
