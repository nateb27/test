/**
 * The computer opponent (PLAN-M2 6): cadence, memory, stamping, save/restore. Owned by WP26 (AI).
 *
 * STUB (TODO(WP26)): `update` issues nothing; `save` stores an empty memory; `restore` accepts any memory. The
 * signatures are contract (WP30 builds the match plumbing against them).
 */

import { SaveError, type AiDifficulty, type Command, type ControllerSave, type JsonValue, type PlayerId, type Sim } from '../../sim';
import type { Controller } from '../controller';

export class AiPlayer implements Controller {
  private constructor(
    readonly playerId: PlayerId,
    readonly difficulty: AiDifficulty,
    private memory: JsonValue,
  ) {}

  /** A fresh AI for `playerId`; its own rng stream is seeded from `seed` and `playerId` (PLAN-M2 6.2). */
  static create(playerId: PlayerId, difficulty: AiDifficulty, _seed: number): AiPlayer {
    return new AiPlayer(playerId, difficulty, {});
  }

  /** Rebuild from a save. Throws `SaveError('corrupt')` on bad memory. */
  static restore(save: ControllerSave): AiPlayer {
    if (save.kind !== 'ai') throw new SaveError('corrupt', 'This save is damaged: an AI controller is of an unknown kind');
    return new AiPlayer(save.playerId, save.difficulty, save.memory);
  }

  /** STUB (TODO(WP26)): returns no commands. */
  update(_sim: Sim): Command[] {
    return [];
  }

  save(): ControllerSave {
    return { playerId: this.playerId, kind: 'ai', difficulty: this.difficulty, memory: this.memory };
  }
}
