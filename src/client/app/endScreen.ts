/**
 * The end screen's view-model and when it appears (PLAN-M2 7.3, 4.13). Client-only: nothing here is saved or hashed.
 */

import { TICK_RATE, type PlayerId, type ReadonlyGameState, type SimEvent } from '../../sim/types';
import type { EndScreenVM } from '../ui/viewModel';

type Reason = EndScreenVM['reason'];

/** The view-model for the current state; `result` and `reason` are decided by the caller. */
export function buildEndScreen(state: ReadonlyGameState, localId: PlayerId, result: EndScreenVM['result'], reason: Reason): EndScreenVM {
  const ticks = state.match.endedTick ?? state.tick;
  return {
    result,
    reason,
    clockSeconds: Math.floor(ticks / TICK_RATE),
    players: state.players
      .filter((p) => p.id !== 0)
      .map((p) => ({
        playerId: p.id,
        name: p.name,
        color: p.color,
        you: p.id === localId,
        outcome: p.outcome,
        stats: structuredClone(p.stats) as EndScreenVM['players'][number]['stats'],
      })),
  };
}

/**
 * Watches a match's events and says when the end screen is due. It fires at most once per match: `MatchEnded` decides
 * (winner = local player: victory; nobody: draw; another player: defeat), and a local `PlayerDefeated` without a
 * `MatchEnded` in the same tick is a defeat on its own (sandbox resign). After "View map" the match carries on and
 * the screen does not return.
 */
export class EndWatcher {
  private shown = false;
  private readonly defeatReasons = new Map<PlayerId, 'conquered' | 'resigned'>();

  constructor(private readonly localId: PlayerId) {}

  /** Returns what to show for this tick's events, or null. */
  observe(events: readonly SimEvent[], state: ReadonlyGameState): EndScreenVM | null {
    let ended: Extract<SimEvent, { type: 'MatchEnded' }> | null = null;
    let localDefeated = false;
    for (const e of events) {
      if (e.type === 'PlayerDefeated') {
        this.defeatReasons.set(e.playerId, e.reason);
        if (e.playerId === this.localId) localDefeated = true;
      } else if (e.type === 'MatchEnded') ended = e;
    }
    if (this.shown || (ended === null && !localDefeated)) return null;
    this.shown = true;
    const resigned = (id: PlayerId): boolean => this.defeatReasons.get(id) === 'resigned';
    if (ended === null || (ended.winner !== null && ended.winner !== this.localId)) {
      return buildEndScreen(state, this.localId, 'defeat', resigned(this.localId) ? 'resigned' : 'conquest');
    }
    if (ended.winner === null) return buildEndScreen(state, this.localId, 'draw', 'conquest');
    const opponentResigned = state.players.some((p) => p.id !== 0 && p.id !== this.localId && resigned(p.id));
    return buildEndScreen(state, this.localId, 'victory', opponentResigned ? 'opponentResigned' : 'conquest');
  }
}
