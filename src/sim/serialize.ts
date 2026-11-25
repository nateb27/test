/**
 * Save format: canonical JSON of `{ version: SAVE_VERSION, state }`.
 * Owned by WP1 (versioning hardened by WP12).
 */

import { registry } from '../data/index';
import type { DataRegistry } from '../data/schema';
import { canonicalJson } from './hash';
import { simFromState } from './sim';
import { SAVE_VERSION, type GameState, type Sim } from './types';

interface SaveFile {
  version: number;
  state: GameState;
}

/** Canonical JSON of the sim's state. Runtime caches are not included. */
export function serialize(sim: Sim): string {
  return canonicalJson({ version: SAVE_VERSION, state: sim.state });
}

/** Rebuild a Sim from `serialize` output. Throws on an unknown version or bad JSON. */
export function deserialize(json: string, data: DataRegistry = registry): Sim {
  const parsed = JSON.parse(json) as Partial<SaveFile> | null;
  if (parsed === null || typeof parsed !== 'object' || parsed.state === undefined) {
    throw new Error('Not a save file');
  }
  if (parsed.version !== SAVE_VERSION) {
    throw new Error(`Unsupported save version: ${String(parsed.version)} (expected ${SAVE_VERSION})`);
  }
  return simFromState(parsed.state, data);
}
