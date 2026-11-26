/**
 * `window.__art`: dev/e2e-only hook for checking the art in the running game (which mode is active, load timings,
 * that every sprite id resolves to non-empty textures, which texture an entity is drawn with) and for staging
 * scenes (issue any command as the local player). Never installed in production builds.
 */

import { allSpriteIds } from '../art/catalog';
import type { GameArt } from '../art/select';
import type { ArtLoadReport } from '../art/rendered/manifest';
import type { BuildingStage, SpriteState, UnitAnimState } from '../art/manifest';
import type { AppHost } from '../app/host';
import type { CommandInput, Facing } from '../../sim/types';
import { DEBUG_HOOKS_ENABLED } from './hook';

export interface ArtAuditRow {
  id: string;
  /** Distinct textures behind the id (all states, facings, ages, variants). */
  textures: number;
  minW: number;
  minH: number;
  /** Fewest opaque (model) pixels in any of them; -1 when the art cannot tell. */
  minOpaque: number;
}

export interface ArtDebugHook {
  mode(): string | null;
  report(): ArtLoadReport | null;
  audit(): ArtAuditRow[];
  drawnTexture(entityId: number): string | null;
  issue(command: CommandInput): void;
}

declare global {
  interface Window {
    __art?: ArtDebugHook;
  }
}

const UNIT_STATES: readonly UnitAnimState[] = ['idle', 'walk', 'work', 'carry'];
const STAGES: readonly BuildingStage[] = ['foundation', 'scaffold', 'complete'];

export function installArtHook(host: AppHost): void {
  if (!DEBUG_HOOKS_ENABLED) return;
  const art = (): GameArt | null => (host.manifest as GameArt | null) ?? null;
  window.__art = {
    mode: () => art()?.artMode ?? null,
    report: () => art()?.rendered?.report ?? null,
    audit() {
      const m = art();
      if (m === null) return [];
      const rows: ArtAuditRow[] = [];
      for (const id of allSpriteIds()) {
        const asset = m.teamSprite(id, 0x6a2c91, 0xd4af37);
        const seen = new Set<unknown>();
        let minW = Infinity;
        let minH = Infinity;
        let minOpaque = Infinity;
        const look = (state: SpriteState, facing: Facing, age: number, seed: number): void => {
          for (const t of asset.animation(state, facing, { age, seed }).frames) {
            if (seen.has(t)) continue;
            seen.add(t);
            minW = Math.min(minW, t.frame.width);
            minH = Math.min(minH, t.frame.height);
            const o = t.label !== undefined ? (m.rendered?.opaquePixels(t.label) ?? -1) : -1;
            minOpaque = Math.min(minOpaque, o);
          }
        };
        if (id.startsWith('unit.')) for (const s of UNIT_STATES) for (let f = 0; f < 8; f++) look(s, f as Facing, 1, 0);
        else if (id.startsWith('building.')) for (const s of STAGES) for (let a = 1; a <= 4; a++) look(s, 0, a, 0);
        else for (let seed = 0; seed < 64; seed++) look('default', 0, 1, seed);
        rows.push({ id, textures: seen.size, minW, minH, minOpaque: Number.isFinite(minOpaque) ? minOpaque : -1 });
      }
      return rows;
    },
    drawnTexture: (id) => host.match?.renderer.drawnTexture(id) ?? null,
    issue: (command) => host.requireMatch().commands.issue(command),
  };
}
