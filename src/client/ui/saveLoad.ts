/**
 * Save / load logic behind the menus: `SaveStorage` slots, file export and
 * import, and plain-language errors (notably for an unsupported save version).
 */

import { deserialize, SaveError, SaveVersionError, serialize } from '../../sim';
import { TICK_RATE, type Sim } from '../../sim/types';
import type { SaveMeta, SaveStorage } from '../platform';

export type LoadResult =
  | { ok: true; sim: Sim }
  | { ok: false; kind: 'empty' | 'unsupportedVersion' | 'corrupt'; message: string };

/** Parse save text into a Sim, or explain why not. Never throws. */
export function parseSave(json: string | null): LoadResult {
  if (json === null || json.trim() === '') {
    return { ok: false, kind: 'empty', message: 'That save slot is empty.' };
  }
  try {
    return { ok: true, sim: deserialize(json) };
  } catch (error) {
    if (error instanceof SaveVersionError) {
      const hint =
        error.direction === 'newer' ? ' It was made by a newer build; update the game to open it.' : '';
      return {
        ok: false,
        kind: 'unsupportedVersion',
        message: `This save is from a different version of the game (save version ${String(error.found)}; this game reads version ${error.expected}) and cannot be loaded.${hint}`,
      };
    }
    if (error instanceof SaveError && error.code === 'corrupt') {
      return { ok: false, kind: 'corrupt', message: 'This save is damaged and cannot be loaded.' };
    }
    return { ok: false, kind: 'corrupt', message: 'This file is not a valid save.' };
  }
}

/** Write the sim's state into a slot. */
export function saveToSlot(storage: SaveStorage, sim: Sim, slot: string, name: string): Promise<SaveMeta> {
  return storage.write(slot, serialize(sim), { name, tick: sim.state.tick });
}

export async function loadFromSlot(storage: SaveStorage, slot: string): Promise<LoadResult> {
  return parseSave(await storage.read(slot));
}

/** A fresh slot key for "save as new". */
export function newSlotKey(nowMs: number): string {
  return `save-${Math.floor(nowMs)}`;
}

/** File name for exporting, e.g. `untitled-rts-12m34s.json`. */
export function exportFileName(name: string, tick: number): string {
  const seconds = Math.floor(tick / TICK_RATE);
  const safe = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${safe === '' ? 'untitled-rts' : safe}-${Math.floor(seconds / 60)}m${seconds % 60}s.json`;
}

export function exportSim(storage: SaveStorage, sim: Sim, name: string): Promise<void> {
  return storage.exportToFile(exportFileName(name, sim.state.tick), serialize(sim));
}

/** Let the player pick a file and load it. Resolves to null if they cancel. */
export async function importSim(storage: SaveStorage): Promise<LoadResult | null> {
  const text = await storage.importFromFile();
  return text === null ? null : parseSave(text);
}
