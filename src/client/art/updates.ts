/**
 * The "art updated" signal (DOM-free): the rendered art's background pass finishes after `load()` resolved and
 * brings sprites and icons that were drawn as placeholders until then (buildings of later ages, units without a
 * sheet). Readers that keep what they read, such as the HUD's icon URLs, subscribe here and read again; the
 * manifests also expose it per instance as `TeamAssetManifest.onUpdate`.
 *
 * Module-level on purpose: the HUD only holds an icon resolver, not the manifest, and an extra re-read is harmless.
 */

let version = 0;
const listeners = new Set<(version: number) => void>();

/** Bumped every time art arrives after loading. */
export function artVersion(): number {
  return version;
}

/** Called by a manifest when sprites or icons changed after its `load()` resolved. */
export function notifyArtUpdate(): void {
  version++;
  for (const l of [...listeners]) l(version);
}

/** Subscribe to art updates. Returns an unsubscribe function. */
export function onArtUpdate(listener: (version: number) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
