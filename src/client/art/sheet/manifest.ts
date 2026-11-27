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
import { resolveUnitState, type IconId, type LoadProgress, type SpriteAnimation, type SpriteAsset, type SpriteContext, type SpriteId, type SpriteState, type UnitAnimState } from '../manifest';
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

/**
 * Frame of each sheet's `attack` on which the blow lands or the missile leaves, read off the Blender rigs
 * (`scripts/art/pipeline/*_anims.py`, frame i at t = i/8): the spear and lance lunge, sword and mace strike, javelin
 * throw, bow loose and ram swing peak at t 0.58-0.68 (frame 5), the axe at t 0.55 (frame 4), the trebuchet's throw is
 * frame 4 and the siphon's stream reaches full flow on frame 3. A sheet's own `hit` wins.
 */
const SHEET_HIT_FRAME: Readonly<Record<string, number>> = {
  villager: 4,
  spearman: 5,
  swordsman: 5,
  archer: 5,
  siphonarios: 3,
  horseman: 5,
  lancer: 5,
  cataphract: 5,
  batteringRam: 5,
  trebuchet: 4,
};

/** The hit frame of a sheet's `attack` (clamped into its frames). */
export function sheetHitFrame(name: string, state: SheetState): number {
  const f = state.hit ?? SHEET_HIT_FRAME[name] ?? Math.floor(state.frames / 2);
  return Math.max(0, Math.min(state.frames - 1, f));
}

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
      ...(st === 'attack' ? { hitFrame: sheetHitFrame(name, state) } : {}),
    };
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
        // The renderer resolves states (`resolveUnitState`); a direct caller asking for one the sheet lacks gets the same fallback.
        const st = resolveUnitState(states, state as UnitAnimState) as string;
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
    // Foot units are tall and narrow: the portrait is their head and upper body, so it fills the frame. Riders and
    // siege engines keep the whole figure.
    const box = iconFacing(name) === 1 ? bustBox(data, w, h) : { x: 0, y: 0, w, h };
    const canvas = document.createElement('canvas');
    canvas.width = box.w;
    canvas.height = box.h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const crop = new Uint8ClampedArray(box.w * box.h * 4);
    for (let r = 0; r < box.h; r++) crop.set(data.subarray(((box.y + r) * w + box.x) * 4, ((box.y + r) * w + box.x + box.w) * 4), r * box.w * 4);
    ctx.putImageData(new ImageData(crop, box.w, box.h), 0, 0);
    return { canvas, ctx, w: box.w / SS, h: box.h / SS };
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
    // Sheet portraits may be scaled up to fill the frame, with crisp pixels.
    const surface = drawIcon(spec, DEFAULT_TEAM, sources, { unitMaxScale: 4, crisp: true });
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

/**
 * The head-and-torso box of a standing figure (RGBA, alpha already 0 or 255), for a portrait that a weapon does not
 * fill. The body starts at the first of two rows at least BODY_ROW of the widest row (and BODY_MIN_PX) wide (a spear
 * shaft or a raised sword above the head is two or three pixels wide and is skipped, a head is wider, even next to a
 * shield as wide as the Spearman's); the bust is the top BUST of the body from there. Columns
 * are kept where the bust rows hold at least BODY_COLUMN of its height in figure pixels (a spear crossing the chest is
 * cut), widened to at least the bust's height times 0.8 so the head is not squeezed. Returns the whole image when it
 * cannot tell.
 */
export function bustBox(data: Uint8ClampedArray, w: number, h: number): { x: number; y: number; w: number; h: number } {
  const rowCount: number[] = [];
  let widest = 0;
  for (let r = 0; r < h; r++) {
    let n = 0;
    for (let c = 0; c < w; c++) if (data[(r * w + c) * 4 + 3]! > 0) n++;
    rowCount.push(n);
    widest = Math.max(widest, n);
  }
  if (widest === 0) return { x: 0, y: 0, w, h };
  let bottom = h - 1;
  while (bottom > 0 && rowCount[bottom] === 0) bottom--;
  let top = -1;
  for (let r = 0; r + 1 < h; r++) {
    const min = Math.max(BODY_MIN_PX, BODY_ROW * widest);
    if (rowCount[r]! >= min && rowCount[r + 1]! >= min) {
      top = r;
      break;
    }
  }
  if (top < 0 || bottom <= top) return { x: 0, y: 0, w, h };
  top = Math.max(0, top - 1);
  const bh = Math.max(1, Math.round((bottom - top + 1) * BUST));
  let x0 = w;
  let x1 = -1;
  for (let c = 0; c < w; c++) {
    let n = 0;
    for (let r = top; r < top + bh; r++) if (data[(r * w + c) * 4 + 3]! > 0) n++;
    if (n >= BODY_COLUMN * bh) {
      x0 = Math.min(x0, c);
      x1 = Math.max(x1, c);
    }
  }
  if (x1 < x0) return { x: 0, y: top, w, h: bh };
  const minW = Math.min(w, Math.round(bh * 0.8));
  while (x1 - x0 + 1 < minW) {
    if (x0 > 0) x0--;
    if (x1 - x0 + 1 < minW && x1 < w - 1) x1++;
  }
  return { x: x0, y: top, w: x1 - x0 + 1, h: bh };
}
const BODY_ROW = 0.15;
/** A weapon shaft is at most this wide in the sheet's pixels; a head is wider. */
const BODY_MIN_PX = 4;
const BUST = 0.6;
const BODY_COLUMN = 0.2;

/** Icon ids the sheet provider serves: unit portraits whose sheet loaded. */
export function claimsIcon(m: SheetManifest, id: IconId): boolean {
  const spec = parseIconId(id);
  return spec !== null && spec.type === 'unit' && m.meta(spec.key) !== null;
}
