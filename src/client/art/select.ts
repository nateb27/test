/**
 * Picks the art for a run: `?art=rendered` (the voxel renderer, default in dev and production) or `?art=fast` (the
 * procedural canvas art, default in the e2e build so the browser suite stays fast). The rendered art is composed
 * with the procedural one, which serves any id the renderer does not claim (and the "?" fallback).
 */

import type { DataRegistry } from '../../data/schema';
import type { TeamAssetManifest } from './procedural';
import type { RenderedManifest } from './rendered/manifest';
import type { SheetManifest } from './sheet/manifest';
import type { ManifestProvider } from './composite';

export type ArtMode = 'fast' | 'rendered';

export interface GameArt extends TeamAssetManifest {
  readonly artMode: ArtMode;
  /** The voxel-rendered provider, when the mode is 'rendered'. */
  readonly rendered: RenderedManifest | null;
  /** The pre-rendered sheets (units, trees, bushes), when the mode is 'rendered'. */
  readonly sheets: SheetManifest | null;
}

/** Art mode from a query string; `defaultMode` applies when `art` is absent or unknown. */
export function artModeFrom(search: string, defaultMode: ArtMode): ArtMode {
  const v = new URLSearchParams(search).get('art');
  return v === 'fast' || v === 'rendered' ? v : defaultMode;
}

export function defaultArtMode(): ArtMode {
  return import.meta.env.MODE === 'e2e' ? 'fast' : 'rendered';
}

export async function createGameArt(registry: DataRegistry, search = typeof location !== 'undefined' ? location.search : ''): Promise<GameArt> {
  const mode = artModeFrom(search, defaultArtMode());
  const { createProceduralManifest } = await import('./procedural');
  const fast = createProceduralManifest({ registry });
  if (mode === 'fast') return Object.assign(fast, { artMode: 'fast' as const, rendered: null, sheets: null });
  const q = new URLSearchParams(search);
  const [{ createRenderedManifest }, { createCompositeManifest }, { createSheetManifest, claimsIcon }] = await Promise.all([
    import('./rendered/manifest'),
    import('./composite'),
    import('./sheet/manifest'),
  ]);
  // Units, trees and bushes from the pre-rendered sheets (`?sheets=0` turns them off); whatever a sheet does not
  // cover, or a sheet that fails to load, falls through to the voxel renderer. The sheets load first, so the voxel
  // renderer skips what they cover.
  const sheets = q.get('sheets') === '0' ? null : createSheetManifest({ registry });
  const rendered = createRenderedManifest({
    registry,
    noWorkers: q.get('artWorkers') === '0',
    noCache: q.get('artCache') === '0',
    fallback: fast,
    covered: sheets === null ? undefined : (id) => sheets.has(id),
  });
  const providers: ManifestProvider[] = [{ manifest: rendered, sprites: (id) => rendered.has(id), icons: () => true, weight: 6 }];
  if (sheets !== null) providers.unshift({ manifest: sheets, sprites: (id) => sheets.has(id), icons: (id) => claimsIcon(sheets, id), weight: 1 });
  const composite = createCompositeManifest(providers, fast);
  return Object.assign(composite, { artMode: 'rendered' as const, rendered, sheets });
}
