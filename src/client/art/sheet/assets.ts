/** URLs of the committed sheets (Vite resolves them relative to the build, `base: './'`). */

const URLS = import.meta.glob('../sheets/*.{json,png}', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

/** File name (e.g. `villager.json`, `villager-0.png`) -> URL. */
export function sheetUrls(): Map<string, string> {
  const m = new Map<string, string>();
  for (const [k, v] of Object.entries(URLS)) m.set(k.slice(k.lastIndexOf('/') + 1), v);
  return m;
}
