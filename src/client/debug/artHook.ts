/**
 * `window.__art`: dev/e2e-only hook for checking the art in the running game (which mode is active, load timings,
 * that every sprite id resolves to non-empty textures, which texture an entity is drawn with) and for staging
 * scenes (issue any command as the local player). Never installed in production builds.
 */

import { allEffectSpriteIds, allSpriteIds } from '../art/catalog';
import type { GameArt } from '../art/select';
import type { ArtLoadReport } from '../art/rendered/manifest';
import type { SheetLoadReport } from '../art/sheet/manifest';
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
  /** States the asset lists (units: idle, walk, ..., attack, death, corpse). */
  states: string[];
  /** Units: frame of `attack` (facing 0) on which the blow lands; null without an attack animation. */
  hitFrame: number | null;
  /** Units: whether `death` plays once (`loop: false`); null without a death animation. */
  deathOnce: boolean | null;
}

export interface RecolourDiff {
  /** Opaque pixels of the frame. */
  pixels: number;
  /** Pixels on the player-colour ramp. */
  team: number;
  /** Pixels whose colour differs between the two player colours. */
  differing: number;
  /** Differing pixels that are not ramp pixels (must be 0). */
  differingOutsideTeam: number;
}

export interface ArtDebugHook {
  mode(): string | null;
  report(): ArtLoadReport | null;
  /** Load report of the pre-rendered sheets (null without them). */
  sheets(): SheetLoadReport | null;
  /** States of a sheet (e.g. 'villager'), with frames and facings, or null. */
  sheetStates(name: string): Record<string, { frames: number; facings: number; loop: boolean }> | null;
  /** Force a unit's animation state (null clears): previews attack, death and corpse, which the sim never triggers. */
  preview(entityId: number, state: string | null): void;
  /** Draw one entity in another player colour (0xRRGGBB, null clears). */
  colour(entityId: number, primary: number | null): void;
  /** Compare a sheet frame recoloured for two player colours. */
  recolourDiff(sheet: string, state: string, facing: number, frame: number, colorA: number, colorB: number): RecolourDiff | null;
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
    sheets: () => art()?.sheets?.report ?? null,
    sheetStates(name) {
      const meta = art()?.sheets?.meta(name) ?? null;
      if (meta === null) return null;
      const out: Record<string, { frames: number; facings: number; loop: boolean }> = {};
      for (const [k, v] of Object.entries(meta.states)) out[k] = { frames: v.frames, facings: v.facings, loop: v.loop };
      return out;
    },
    colour: (id, primary) => host.match?.renderer.previewColour?.(id, primary),
    preview: (id, state) => host.match?.renderer.previewAnimation?.(id, state as UnitAnimState | null),
    recolourDiff(sheet, state, facing, frame, colorA, colorB) {
      const sh = art()?.sheets ?? null;
      const a = sh?.framePixels(sheet, state, facing, frame, colorA) ?? null;
      const b = sh?.framePixels(sheet, state, facing, frame, colorB) ?? null;
      if (a === null || b === null) return null;
      let pixels = 0;
      let team = 0;
      let differing = 0;
      let differingOutsideTeam = 0;
      for (let i = 0; i < a.w * a.h; i++) {
        if (a.rgba[i * 4 + 3]! !== 255) continue;
        pixels++;
        team += a.team[i]!;
        const d = a.rgba[i * 4] !== b.rgba[i * 4] || a.rgba[i * 4 + 1] !== b.rgba[i * 4 + 1] || a.rgba[i * 4 + 2] !== b.rgba[i * 4 + 2];
        if (d) {
          differing++;
          if (a.team[i] === 0) differingOutsideTeam++;
        }
      }
      return { pixels, team, differing, differingOutsideTeam };
    },
    audit() {
      const m = art();
      if (m === null) return [];
      const rows: ArtAuditRow[] = [];
      for (const id of [...allSpriteIds(), ...allEffectSpriteIds()]) {
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
            const o = t.label === undefined ? -1 : t.label.startsWith('sheet.') ? (m.sheets?.opaquePixels(t.label) ?? -1) : (m.rendered?.opaquePixels(t.label) ?? -1);
            minOpaque = Math.min(minOpaque, o);
          }
        };
        if (id.startsWith('unit.')) for (const s of [...UNIT_STATES, ...asset.states] as SpriteState[]) for (let f = 0; f < 8; f++) look(s, f as Facing, 1, 0);
        else if (id.startsWith('building.')) for (const s of STAGES) for (let a = 1; a <= 4; a++) look(s, 0, a, 0);
        else for (let seed = 0; seed < 64; seed++) look('default', 0, 1, seed);
        const unit = id.startsWith('unit.');
        const has = (st: string): boolean => (asset.states as readonly string[]).includes(st);
        rows.push({
          id,
          textures: seen.size,
          minW,
          minH,
          minOpaque: Number.isFinite(minOpaque) ? minOpaque : -1,
          states: [...asset.states],
          hitFrame: unit && has('attack') ? (asset.animation('attack', 0).hitFrame ?? null) : null,
          deathOnce: unit && has('death') ? asset.animation('death', 0).loop === false : null,
        });
      }
      return rows;
    },
    drawnTexture: (id) => host.match?.renderer.drawnTexture(id) ?? null,
    issue: (command) => host.requireMatch().commands.issue(command),
  };
}
