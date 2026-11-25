/**
 * Save storage behind an interface so a desktop wrapper can replace it (plan 8).
 */

/** Metadata stored beside each save. */
export interface SaveMeta {
  /** Storage key chosen by the caller, e.g. 'quick' or 'slot3'. */
  slot: string;
  /** Display name. */
  name: string;
  /** Wall-clock time of saving, epoch milliseconds (client-side only, never in sim state). */
  savedAt: number;
  /** Sim tick at save time. */
  tick: number;
}

export interface SaveStorage {
  /** All saves, newest first. */
  list(): Promise<SaveMeta[]>;
  /** The save data (output of `serialize`) or null if the slot is empty. */
  read(slot: string): Promise<string | null>;
  /** Write (or overwrite) a slot. */
  write(slot: string, data: string, meta: { name: string; tick: number }): Promise<SaveMeta>;
  remove(slot: string): Promise<void>;
  /** Offer `data` to the user as a downloadable file. */
  exportToFile(fileName: string, data: string): Promise<void>;
  /** Let the user pick a file; resolves to its text, or null if cancelled. */
  importFromFile(): Promise<string | null>;
}

const DATA_PREFIX = 'rts.save.';
const META_PREFIX = 'rts.saveMeta.';

/** `localStorage`-backed implementation with file export/import through the DOM. */
export class LocalSaveStorage implements SaveStorage {
  constructor(
    private readonly storage: Storage = window.localStorage,
    private readonly now: () => number = () => Date.now(),
  ) {}

  list(): Promise<SaveMeta[]> {
    const metas: SaveMeta[] = [];
    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i);
      if (key === null || !key.startsWith(META_PREFIX)) continue;
      const raw = this.storage.getItem(key);
      if (raw === null) continue;
      try {
        metas.push(JSON.parse(raw) as SaveMeta);
      } catch {
        // Ignore corrupt metadata.
      }
    }
    metas.sort((a, b) => b.savedAt - a.savedAt);
    return Promise.resolve(metas);
  }

  read(slot: string): Promise<string | null> {
    return Promise.resolve(this.storage.getItem(DATA_PREFIX + slot));
  }

  write(slot: string, data: string, meta: { name: string; tick: number }): Promise<SaveMeta> {
    const full: SaveMeta = { slot, name: meta.name, tick: meta.tick, savedAt: this.now() };
    this.storage.setItem(DATA_PREFIX + slot, data);
    this.storage.setItem(META_PREFIX + slot, JSON.stringify(full));
    return Promise.resolve(full);
  }

  remove(slot: string): Promise<void> {
    this.storage.removeItem(DATA_PREFIX + slot);
    this.storage.removeItem(META_PREFIX + slot);
    return Promise.resolve();
  }

  exportToFile(fileName: string, data: string): Promise<void> {
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return Promise.resolve();
  }

  importFromFile(): Promise<string | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (file === undefined) {
          resolve(null);
          return;
        }
        file.text().then(resolve, () => resolve(null));
      });
      input.addEventListener('cancel', () => resolve(null));
      input.click();
    });
  }
}
