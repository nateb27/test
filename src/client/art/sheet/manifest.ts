/**
 * Sprite provider backed by the pre-rendered sheets (Blender, `scripts/art/`): every unit (8 facings, all states)
 * and the trees and berry bushes. Plugged into the composite manifest ahead of the voxel renderer, so an id whose
 * sheet is missing or fails to load falls through to the voxel art.
 *
 * Nothing is rendered at load: the indexed PNG pages are fetched and decoded (palette indices), and textures are made
 * per player colour the first time a sheet is drawn in that colour, by swapping the 16 team-ramp indices for the
 * player's ramp (`teamRamp`). The ground shadows are a separate layer (`SpriteAnimation.shadows`), shared by all
 * colours.
 */

import { CanvasSource, Rectangle, Texture } from 'pixi.js';
import type { DataRegistry } from '../../../data/schema';
import type { Facing } from '../../../sim/types';
import { classifySprite, iconFacing, parseIconId, parseSpriteId, UNIT_IDS } from '../catalog';
import { SS, type Surface } from '../draw';
import { drawIcon, type IconSources } from '../icons';
import type { IconId, LoadProgress, SpriteAnimation, SpriteAsset, SpriteContext, SpriteId, SpriteState, UnitAnimState } from '../manifest';
import { DEFAULT_PRIMARY, DEFAULT_TEAM } from '../palette';
import type { TeamAssetManifest } from '../procedural';
import { teamRamp } from '../rendered/quantize';
import { sheetUrls } from './assets';
import { layerPixels, validateSheet, type SheetMeta, type SheetState } from './meta';
import { decodeIndexedPng, type IndexedPng } from './png';

/** Sheets the game looks for: one per unit, plus the trees and berry bushes. */
export const SHEET_NAMES: readonly string[] = [...UNIT_IDS, 'tree', 'berryBush'];

export interface SheetLoadReport {
  ms: number;
  /** Bytes of PNG and JSON fetched. */
  bytes: number;
  sheets: string[];
  /** Sheets that were expected but missing or broken (served by the fallback art). */
  failed: string[];
}

export interface SheetManifest extends TeamAssetManifest {
  readonly report: SheetLoadReport | null;
  meta(name: string): SheetMeta | null;
  /** Opaque figure pixels of a frame by texture label (`sheet.<name>|<state>|<facing>|<frame>`), -1 if unknown. */
  opaquePixels(label: string): number;
  /** RGBA of a frame's figure layer recoloured for `primary` (tests: red vs blue). */
  framePixels(sheet: string, state: string, facing: number, frame: number, primary: number): { w: number; h: number; rgba: Uint8ClampedArray; team: Uint8Array } | null;
}

interface Loaded {
  meta: SheetMeta;
  pages: IndexedPng[];
}

/** Generic states the renderer may ask for, mapped onto what a sheet has. */
const STATE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  work: ['build', 'chop', 'attack', 'idle'],
  carry: ['carryWood', 'walk'],
  carryWood: ['carry', 'walk'],
  carryFood: ['carry', 'walk'],
  carryGold: ['carry', 'walk'],
  carryStone: ['carry', 'walk'],
  chop: ['work'],
  mine: ['work'],
  farm: ['work'],
  forage: ['work'],
  build: ['work'],
};

function seedHash(n: number): number {
  let h = Math.imul(n | 0, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}

export interface SheetManifestOptions {
  registry?: DataRegistry;
  /** Override where sheets come from (tests). */
  fetchBytes?: (file: string) => Promise<Uint8Array | null>;
}

export function createSheetManifest(options: SheetManifestOptions = {}): SheetManifest {
  const sheets = new Map<string, Loaded>();
  const figurePages = new Map<string, Texture[]>();
  const shadowPages = new Map<string, Texture[]>();
  const assets = new Map<string, SpriteAsset>();
  const icons = new Map<string, { surface: Surface; texture: Texture; url: string | null }>();
  const owned: Texture[] = [];
  const spriteAlias = new Map<string, string>();
  let report: SheetLoadReport | null = null;

  const reg = options.registry;
  if (reg !== undefined) {
    const add = (sprite: string, kind: string, id: string): void => {
      if (classifySprite(sprite) === 'known') return;
      const c = `${kind}.${id}`;
      if (classifySprite(c) === 'known') spriteAlias.set(sprite, c);
    };
    for (const u of reg.units) add(u.sprite, 'unit', u.id);
    for (const n of reg.nodes) add(n.sprite, 'node', n.id);
  }

  async function defaultFetch(file: string): Promise<Uint8Array | null> {
    const url = sheetUrls().get(file);
    if (url === undefined) return null;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
  const fetchBytes = options.fetchBytes ?? defaultFetch;

  function sheetKey(id: string): string | null {
    const p = parseSpriteId(spriteAlias.get(id) ?? id);
    if (p === null || p.key === null) return null;
    if (p.kind === 'unit' || (p.kind === 'node' && (p.key === 'tree' || p.key === 'berryBush'))) return sheets.has(p.key) ? p.key : null;
    return null;
  }

  function pageTextures(name: string, layer: 'figure' | 'shadow', primary: number): Texture[] {
    const key = layer === 'shadow' ? name : `${name}#${primary}`;
    const cache = layer === 'shadow' ? shadowPages : figurePages;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const s = sheets.get(name)!;
    const ramp = layer === 'figure' ? teamRamp(primary) : null;
    const list = s.pages.map((pg) => {
      const canvas = document.createElement('canvas');
      canvas.width = pg.width;
      canvas.height = pg.height;
      const ctx = canvas.getContext('2d')!;
      ctx.putImageData(new ImageData(layerPixels(pg, s.meta, layer, ramp) as Uint8ClampedArray<ArrayBuffer>, pg.width, pg.height), 0, 0);
      // Crisp pixels when zoomed in, smooth when zoomed out (like the voxel atlases).
      return new Texture({ source: new CanvasSource({ resource: canvas, magFilter: 'nearest', minFilter: 'linear' }) });
    });
    cache.set(key, list);
    return list;
  }

  function frameTexture(name: string, st: string, state: SheetState, idx: number, layer: 'figure' | 'shadow', primary: number): Texture {
    const s = sheets.get(name)!;
    const [pg, x, y, w, h, ox, oy] = state.f[idx]!;
    const page = pageTextures(name, layer, primary)[pg]!;
    const [W, H] = s.meta.size;
    const t = new Texture({
      source: page.source,
      frame: new Rectangle(x, y, w, h),
      orig: new Rectangle(0, 0, W, H),
      trim: new Rectangle(ox, oy, w, h),
      label: `sheet.${name}|${st}|${Math.floor(idx / state.frames)}|${idx % state.frames}${layer === 'shadow' ? '|shadow' : ''}`,
    });
    owned.push(t);
    return t;
  }

  function animationFor(name: string, st: string, facing: number, primary: number): SpriteAnimation {
    const s = sheets.get(name)!;
    const state = s.meta.states[st]!;
    const fc = state.facings > 1 ? facing & 7 : 0;
    const frames: Texture[] = [];
    const shadows: Texture[] = [];
    const modelTop: number[] = [];
    const bodies: { x: number; y: number; w: number; h: number }[] = [];
    for (let i = 0; i < state.frames; i++) {
      const idx = fc * state.frames + i;
      frames.push(frameTexture(name, st, state, idx, 'figure', primary));
      shadows.push(frameTexture(name, st, state, idx, 'shadow', primary));
      const fr = state.f[idx]!;
      modelTop.push(fr[8]);
      bodies.push({ x: fr[7], y: fr[8], w: fr[9] - fr[7], h: fr[10] - fr[8] });
    }
    return {
      frames,
      frameMs: state.ms,
      mirrorX: false,
      modelTop,
      shadows,
      bodies,
      loop: state.loop,
      ...(state.cycle !== undefined ? { cycle: state.cycle } : {}),
    };
  }

  function resolveState(meta: SheetMeta, state: string): string {
    if (meta.states[state] !== undefined) return state;
    for (const a of STATE_ALIASES[state] ?? []) if (meta.states[a] !== undefined) return a;
    return 'idle';
  }

  function unitAsset(id: string, name: string, primary: number): SpriteAsset {
    const s = sheets.get(name)!;
    const table = new Map<string, SpriteAnimation>();
    const states = Object.keys(s.meta.states) as UnitAnimState[];
    return {
      id,
      anchor: { x: s.meta.anchor[0] / s.meta.size[0], y: s.meta.anchor[1] / s.meta.size[1] },
      states,
      animation(state: SpriteState, facing: Facing): SpriteAnimation {
        const st = resolveState(s.meta, state);
        const k = `${st}|${facing & 7}`;
        let a = table.get(k);
        if (a === undefined) {
          a = animationFor(name, st, facing, primary);
          table.set(k, a);
        }
        return a;
      },
    };
  }

  function nodeAsset(id: string, name: string): SpriteAsset {
    const s = sheets.get(name)!;
    const n = s.meta.variants ?? 1;
    const anims: SpriteAnimation[] = [];
    for (let v = 0; v < n; v++) anims.push(animationFor(name, `v${v}`, 0, DEFAULT_PRIMARY));
    return {
      id,
      anchor: { x: s.meta.anchor[0] / s.meta.size[0], y: s.meta.anchor[1] / s.meta.size[1] },
      states: ['default'],
      variants: n,
      animation: (_s, _f, ctx?: SpriteContext) => anims[ctx?.seed === undefined ? 0 : seedHash(ctx.seed) % n]!,
    };
  }

  function teamSprite(id: SpriteId, primary: number): SpriteAsset {
    const name = sheetKey(id);
    if (name === null) throw new Error(`no sheet for sprite ${id}`);
    const isNode = name === 'tree' || name === 'berryBush';
    const key = isNode ? name : `${name}#${primary}`;
    let a = assets.get(key);
    if (a === undefined) {
      a = isNode ? nodeAsset(id, name) : unitAsset(id, name, primary);
      assets.set(key, a);
    }
    return a;
  }

  /** Figure pixels of the unit's HUD portrait (or its idle frame) as a canvas Surface. */
  function portrait(name: string): Surface | null {
    const s = sheets.get(name);
    if (s === undefined) return null;
    const idle = s.meta.states.idle;
    const rect = s.meta.icon ?? (idle === undefined ? undefined : idle.f[(idle.facings > 1 ? iconFacing(name) : 0) * idle.frames]);
    if (rect === undefined) return null;
    const [pg, x, y, w, h] = rect;
    const png = s.pages[pg]!;
    const all = layerPixels(png, s.meta, 'figure', teamRamp(DEFAULT_PRIMARY));
    const data = new Uint8ClampedArray(w * h * 4);
    for (let r = 0; r < h; r++) data.set(all.subarray(((y + r) * png.width + x) * 4, ((y + r) * png.width + x + w) * 4), r * w * 4);
    // Keep only opaque pixels (drop the soft outline) for a clean icon.
    for (let i = 3; i < data.length; i += 4) if (data[i]! < 255) data[i] = 0;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.putImageData(new ImageData(data, w, h), 0, 0);
    return { canvas, ctx, w: w / SS, h: h / SS };
  }

  function iconEntry(id: IconId): { surface: Surface; texture: Texture; url: string | null } {
    const hit = icons.get(id);
    if (hit !== undefined) return hit;
    const spec = parseIconId(id);
    const sources: IconSources = {
      unit: (k) => portrait(k),
      building: () => null,
      node: () => null,
    };
    const surface = drawIcon(spec, DEFAULT_TEAM, sources);
    const texture = new Texture({ source: new CanvasSource({ resource: surface.canvas, resolution: SS }) });
    owned.push(texture);
    const e = { surface, texture, url: null as string | null };
    icons.set(id, e);
    return e;
  }

  return {
    get report() {
      return report;
    },
    meta: (name) => sheets.get(name)?.meta ?? null,
    opaquePixels(label) {
      const m = /^sheet\.([^|]+)\|([^|]+)\|(\d+)\|(\d+)$/.exec(label);
      if (m === null) return -1;
      const s = sheets.get(m[1]!);
      const st = s?.meta.states[m[2]!];
      if (s === undefined || st === undefined) return -1;
      const [pg, x, y, w, h] = st.f[Number(m[3]) * st.frames + Number(m[4])]!;
      const png = s.pages[pg]!;
      let n = 0;
      for (let r = 0; r < h; r++)
        for (let c = 0; c < w; c++) {
          const i = png.indices[(y + r) * png.width + x + c]!;
          if (png.alpha[i] === 255 && i !== 0) n++;
        }
      return n;
    },
    framePixels(sheet, state, facing, frame, primary) {
      const s = sheets.get(sheet);
      const st = s?.meta.states[state];
      if (s === undefined || st === undefined) return null;
      const [pg, x, y, w, h] = st.f[(st.facings > 1 ? facing : 0) * st.frames + frame]!;
      const png = s.pages[pg]!;
      const all = layerPixels(png, s.meta, 'figure', teamRamp(primary));
      const rgba = new Uint8ClampedArray(w * h * 4);
      const team = new Uint8Array(w * h);
      for (let r = 0; r < h; r++) {
        rgba.set(all.subarray(((y + r) * png.width + x) * 4, ((y + r) * png.width + x + w) * 4), r * w * 4);
        for (let c = 0; c < w; c++) {
          const i = png.indices[(y + r) * png.width + x + c]!;
          team[r * w + c] = i >= s.meta.team[0] && i < s.meta.team[0] + s.meta.team[1] ? 1 : 0;
        }
      }
      return { w, h, rgba, team };
    },
    async load(onProgress?: LoadProgress): Promise<void> {
      if (report !== null) {
        onProgress?.(1);
        return;
      }
      const t0 = performance.now();
      let bytes = 0;
      const failed: string[] = [];
      let done = 0;
      await Promise.all(
        SHEET_NAMES.map(async (name) => {
          try {
            const j = await fetchBytes(`${name}.json`);
            if (j === null) {
              failed.push(name);
              return;
            }
            bytes += j.length;
            const meta = JSON.parse(new TextDecoder().decode(j)) as SheetMeta;
            const pages: IndexedPng[] = [];
            for (const file of meta.pages) {
              const b = await fetchBytes(file);
              if (b === null) throw new Error(`missing ${file}`);
              bytes += b.length;
              pages.push(await decodeIndexedPng(b));
            }
            const errs = validateSheet(meta, pages);
            if (errs.length > 0) throw new Error(errs.slice(0, 3).join('; '));
            sheets.set(name, { meta, pages });
          } catch (e) {
            failed.push(name);
            console.warn(`sprite sheet ${name} not used:`, e);
          } finally {
            onProgress?.(++done / SHEET_NAMES.length);
          }
        }),
      );
      report = { ms: performance.now() - t0, bytes, sheets: [...sheets.keys()].sort(), failed: failed.sort() };
      onProgress?.(1);
    },
    has: (id) => sheetKey(id) !== null,
    sprite: (id) => teamSprite(id, DEFAULT_PRIMARY),
    teamSprite: (id, primary) => teamSprite(id, primary),
    isFallback: (id) => sheetKey(id) === null,
    isFallbackIcon: () => false,
    /** Unit icons only (the composite asks only for those, see `claimsIcon`). */
    iconTexture: (id) => iconEntry(id).texture,
    iconUrl: (id) => {
      const e = iconEntry(id);
      e.url ??= e.surface.canvas.toDataURL('image/png');
      return e.url;
    },
    destroy(): void {
      for (const t of owned) t.destroy(false);
      for (const list of [...figurePages.values(), ...shadowPages.values()]) for (const t of list) t.destroy(true);
      owned.length = 0;
      figurePages.clear();
      shadowPages.clear();
      assets.clear();
      icons.clear();
      sheets.clear();
    },
  };
}

/** Icon ids the sheet provider serves: unit portraits whose sheet loaded. */
export function claimsIcon(m: SheetManifest, id: IconId): boolean {
  const spec = parseIconId(id);
  return spec !== null && spec.type === 'unit' && m.meta(spec.key) !== null;
}
