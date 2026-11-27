/**
 * A manifest composed of several providers: each sprite id is served by the first provider that claims it, so a
 * sprite source can be swapped per id (e.g. units and trees from pre-rendered sheets, everything else from the voxel
 * renderer) without touching game code. Icons and terrain come from the first provider that has them; ids nobody
 * claims fall through to the `fallback` provider (the procedural art, which draws a visible "?" for unknown ids).
 */

import type { IconId, LoadProgress, SpriteAsset, SpriteId, TerrainArt } from './manifest';
import type { TeamAssetManifest } from './procedural';

export interface ManifestProvider {
  manifest: TeamAssetManifest;
  /** Sprite ids this provider serves. */
  sprites: (id: SpriteId) => boolean;
  /** Icon ids this provider serves (default: none). */
  icons?: (id: IconId) => boolean;
  /** Relative share of the load progress bar (default 1). */
  weight?: number;
}

export function createCompositeManifest(providers: readonly ManifestProvider[], fallback: TeamAssetManifest): TeamAssetManifest {
  const forSprite = (id: SpriteId): TeamAssetManifest => providers.find((p) => p.sprites(id))?.manifest ?? fallback;
  const forIcon = (id: IconId): TeamAssetManifest => providers.find((p) => p.icons?.(id) === true)?.manifest ?? fallback;
  return {
    async load(onProgress?: LoadProgress): Promise<void> {
      const weights = providers.map((p) => p.weight ?? 1);
      const total = weights.reduce((a, b) => a + b, 0) || 1;
      let base = 0;
      for (let i = 0; i < providers.length; i++) {
        const w = weights[i]! / total;
        const b = base;
        await providers[i]!.manifest.load((f) => onProgress?.(b + f * w));
        base += w;
      }
      onProgress?.(1);
    },
    has: (id) => forSprite(id).has(id),
    sprite: (id): SpriteAsset => forSprite(id).sprite(id),
    teamSprite: (id, primary, secondary) => forSprite(id).teamSprite(id, primary, secondary),
    isFallback: (id) => forSprite(id).isFallback(id),
    isFallbackIcon: (id) => forIcon(id).isFallbackIcon(id),
    iconTexture: (id) => forIcon(id).iconTexture(id),
    iconUrl: (id) => forIcon(id).iconUrl(id),
    terrain(): TerrainArt | null {
      for (const p of providers) {
        const t = p.manifest.terrain?.() ?? null;
        if (t !== null) return t;
      }
      return fallback.terrain?.() ?? null;
    },
    onUpdate(listener: () => void): () => void {
      const offs = [...providers.map((p) => p.manifest), fallback].map((m) => m.onUpdate?.(listener) ?? ((): void => {}));
      return () => {
        for (const off of offs) off();
      };
    },
    destroy(): void {
      for (const p of providers) p.manifest.destroy();
      fallback.destroy();
    },
  };
}
