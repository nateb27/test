/**
 * TEMPORARY (WP10), for the integrator to remove once WP7's real `canPlace` and
 * the HUD's command card exist:
 *
 * 1. `tempCanPlace`: `sim.query.canPlace` while it is still the WP1 stub (it
 *    answers `size: 1` for every type), otherwise a client-side approximation
 *    (bounds, buildable terrain, no overlapping building or node) so the ghost
 *    can be exercised. Once the real function lands it is used as is.
 * 2. `installPlacementDebug`: dev/e2e-only `window.__wp10` and keys F6 (place a
 *    House) and F7 (set rally) to enter the modes without the HUD.
 */

import type { DataRegistry } from '../../../data/schema';
import type { BuildingId, PlacementResult, PlacementTileProblem, PlayerId, Sim } from '../../../sim/types';
import { DEBUG_HOOKS_ENABLED } from '../../debug/hook';
import type { ModeController } from './index';

export function tempCanPlace(sim: Sim, playerId: PlayerId, registry: DataRegistry): (type: BuildingId, tx: number, ty: number) => PlacementResult {
  return (type, tx, ty) => {
    const def = registry.def(type);
    const size = def !== undefined && def.kind === 'building' ? def.footprint : 1;
    const real = sim.query.canPlace(playerId, type, tx, ty);
    if (real.size === size) return real;
    const { map, entities } = sim.state;
    const tiles: (PlacementTileProblem | null)[] = [];
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const x = tx + i;
        const y = ty + j;
        let problem: PlacementTileProblem | null = null;
        if (x < 0 || y < 0 || x >= map.width || y >= map.height) problem = 'outOfBounds';
        else if (registry.terrains.find((t) => t.id === map.tiles[y * map.width + x])?.buildable === false) problem = 'notBuildable';
        else {
          for (const e of entities) {
            if (e.kind === 'unit') continue;
            const d = registry.def(e.typeId);
            const s = d !== undefined && (d.kind === 'building' || d.kind === 'node') ? d.footprint : 1;
            if (x >= e.tile.tx && x < e.tile.tx + s && y >= e.tile.ty && y < e.tile.ty + s) {
              problem = 'occupied';
              break;
            }
          }
        }
        tiles.push(problem);
      }
    }
    const availability = sim.query.availability(playerId, type);
    // The WP8 availability stub says "unavailable, no reasons"; treat that as available so terrain can be tested.
    const rulesOk = (availability.available || availability.reasons.length === 0) && availability.affordable;
    const ok = tiles.every((t) => t === null) && rulesOk;
    return { ok, size, tiles, availability };
  };
}

declare global {
  interface Window {
    /** TEMPORARY (WP10) debug entry points; dev and e2e builds only. */
    __wp10?: {
      startPlacement(type: BuildingId): void;
      startRally(): void;
      cancel(): void;
      mode(): 'placement' | 'rally' | null;
      ghost(): { tx: number; ty: number; size: number; ok: boolean; visible: boolean; reason: string | null; tileOk: boolean[] } | null;
      /** Sprites the overlays drew on the last frame. */
      overlayStats(): Record<string, number>;
      /** World tiles -> page px on the minimap. */
      minimapToPage(x: number, y: number): { x: number; y: number };
    };
  }
}

export function installPlacementDebug(
  modes: ModeController,
  minimapToPage: (x: number, y: number) => { x: number; y: number },
  overlayStats: () => Record<string, number>,
): () => void {
  if (!DEBUG_HOOKS_ENABLED) return () => {};
  window.__wp10 = {
    startPlacement: (type) => void modes.startPlacement(type),
    startRally: () => void modes.startRally(),
    cancel: () => modes.cancel(),
    mode: () => modes.active?.kind ?? null,
    ghost: () => {
      const g = modes.ghost();
      return g === null ? null : { tx: g.tx, ty: g.ty, size: g.size, ok: g.ok, visible: g.visible, reason: g.reason, tileOk: [...g.tileOk] };
    },
    overlayStats,
    minimapToPage,
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.code === 'F6') {
      e.preventDefault();
      modes.startPlacement('house');
    } else if (e.code === 'F7') {
      e.preventDefault();
      modes.startRally();
    }
  };
  window.addEventListener('keydown', onKey);
  return () => {
    window.removeEventListener('keydown', onKey);
    delete window.__wp10;
  };
}
