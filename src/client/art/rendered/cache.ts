/**
 * IndexedDB cache of finished atlases, keyed by a hash of the art sources and the job list, so later loads skip
 * rendering. Every storage call is wrapped: private windows, blocked storage or a missing IndexedDB simply mean a
 * cache miss, never an error.
 */

import type { Atlas } from './atlas';
import type { TerrainTexOut } from './terrainTex';

const DB = 'rts-art';
const STORE = 'atlas';

export interface CachedArt {
  key: string;
  atlas: Atlas;
  terrain: TerrainTexOut[];
}

/** FNV-1a over a string, as 8 hex digits. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Cache key: art source hash (build time), palette and the job list. */
export function cacheKey(sourceHash: string, palette: readonly number[], jobs: readonly unknown[]): string {
  return `v1-${sourceHash}-${fnv1a(palette.join(','))}-${fnv1a(JSON.stringify(jobs))}`;
}

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
      }
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        try {
          req.result.createObjectStore(STORE);
        } catch {
          // already there
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function loadCached(key: string): Promise<CachedArt | null> {
  const db = await open();
  if (db === null) return null;
  try {
    return await new Promise<CachedArt | null>((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => {
          const v = req.result as CachedArt | undefined;
          resolve(v !== undefined && v.key === key && Array.isArray(v.atlas?.pages) ? v : null);
        };
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  } finally {
    try {
      db.close();
    } catch {
      // ignore
    }
  }
}

/** Store the art under `key`, dropping older entries. Resolves true when written. */
export async function saveCached(art: CachedArt): Promise<boolean> {
  const db = await open();
  if (db === null) return false;
  try {
    return await new Promise<boolean>((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        store.clear();
        store.put(art, art.key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  } finally {
    try {
      db.close();
    } catch {
      // ignore
    }
  }
}
