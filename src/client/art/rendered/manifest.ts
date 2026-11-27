/**
 * The rendered AssetManifest: every building (per age look and construction stage), unit (8 facings, 4 states,
 * 2 frames), resource node variant, HUD icon of those, and the terrain textures, ray-traced at load by the voxel
 * renderer in Web Workers, packed into atlases and cached in IndexedDB.
 *
 * Player colour: team cloth is rendered with a reference blue and stored with a shade level per pixel; each page is
 * re-tinted to a player's colour ramp the first time that colour is asked for.
 */

import { CanvasSource, Rectangle, Texture } from 'pixi.js';
import type { DataRegistry } from '../../../data/schema';
import type { Facing } from '../../../sim/types';
import { BUILDING_IDS, classifyIcon, classifySprite, parseIconId, parseSpriteId, type BuildingKey, type NodeKey, type UnitKey } from '../catalog';
import { SS, type Surface } from '../draw';
import { drawIcon, type IconSources } from '../icons';
import type {
  BuildingStage,
  IconId,
  LoadProgress,
  SpriteAnimation,
  SpriteAsset,
  SpriteContext,
  SpriteId,
  SpriteState,
  TerrainArt,
  BasicUnitState as UnitAnimState,
} from '../manifest';
import { DEFAULT_PRIMARY, DEFAULT_TEAM } from '../palette';
import type { TeamAssetManifest } from '../procedural';
import { buildAtlas, type Atlas, type AtlasEntry } from './atlas';
import { cacheKey, loadCached, saveCached } from './cache';
import { allJobs, type Job, BERRY_VARIANTS, buildingSpriteName, DEPOSIT_VARIANTS, unitSpriteName, unitStateSource, UNIT_STATES, buildingFrame, isEssential, type NamedSprite } from './jobs';
import { lookFor } from './models/looks';
import { TREE_VARIANTS } from './models/nature';
import { PALETTE_RGB } from './paletteData';
import { runJobs } from './pool';
import { teamRamp } from './quantize';
import { PERIOD, TEX_H, TEX_W, type TerrainTexOut } from './terrainTex';

declare const __ART_HASH__: string;

export interface ArtLoadReport {
  /** Until load() resolved (the first age's art is ready). */
  ms: number;
  /** Until every sprite was ready (the rest renders in the background), or null while it still is. */
  msComplete: number | null;
  complete: boolean;
  cached: boolean;
  workers: number;
  mainThreadJobs: number;
  sprites: number;
  pages: number;
}

export interface RenderedManifestOptions {
  registry?: DataRegistry;
  /** Render on the main thread only (time-sliced). */
  noWorkers?: boolean;
  /** Neither read nor write the IndexedDB cache. */
  noCache?: boolean;
  /** Serves sprites that are still rendering in the background (the procedural art). */
  fallback?: TeamAssetManifest;
  onReport?: (r: ArtLoadReport) => void;
  /**
   * Sprite ids another provider already serves (the pre-rendered sheets, asked once their load has finished): their
   * voxel jobs are skipped. They stay the fallback when that provider has nothing for them.
   */
  covered?: (spriteId: string) => boolean;
}

function jobSprite(j: Job): string | null {
  switch (j.type) {
    case 'unit':
    case 'unitIcon':
      return `unit.${j.key}`;
    case 'tree':
      return 'node.tree';
    case 'berry':
      return 'node.berryBush';
    default:
      return null;
  }
}

export interface RenderedManifest extends TeamAssetManifest {
  readonly report: ArtLoadReport | null;
  /** Atlas entry names (debug and tests). */
  spriteNames(): string[];
  /** Fully opaque (model) pixels of an atlas entry, -1 if unknown (debug and tests). */
  opaquePixels(name: string): number;
}

const NODE_VARIANTS: Readonly<Record<NodeKey, number>> = {
  tree: TREE_VARIANTS.length,
  berryBush: BERRY_VARIANTS,
  goldDeposit: DEPOSIT_VARIANTS,
  stoneDeposit: DEPOSIT_VARIANTS,
};

/** Earthy icon frames: the rendered buildings and nodes are light and wash out on the pale procedural ones. */
const ICON_THEMES = { building: { top: '#6f6a4c', bottom: '#2f2c1f' }, node: { top: '#5d6b39', bottom: '#28311a' } };

const FRAME_MS: Readonly<Record<UnitAnimState, number>> = { idle: 700, walk: 220, work: 300, carry: 240 };
const STAGES: readonly BuildingStage[] = ['foundation', 'scaffold', 'complete'];

function seedHash(n: number): number {
  let h = Math.imul(n | 0, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}

export function createRenderedManifest(options: RenderedManifestOptions = {}): RenderedManifest {
  let atlas: Atlas | null = null;
  let terrainArt: TerrainArt | null = null;
  let report: ArtLoadReport | null = null;
  let terrainTex: TerrainTexOut[] = [];
  const byName = new Map<string, AtlasEntry>();
  const pageTextures = new Map<number, Texture[]>();
  const entryTextures = new Map<string, Texture>();
  const assets = new Map<string, SpriteAsset>();
  const icons = new Map<string, { surface: Surface; texture: Texture; url: string | null }>();
  const surfaces = new Map<string, Surface | null>();
  const owned: Texture[] = [];
  const spriteAlias = new Map<string, string>();

  const reg = options.registry;
  if (reg !== undefined) {
    const add = (sprite: string, kind: string, id: string): void => {
      if (classifySprite(sprite) === 'known') return;
      const c = `${kind}.${id}`;
      if (classifySprite(c) === 'known') spriteAlias.set(sprite, c);
    };
    for (const u of reg.units) add(u.sprite, 'unit', u.id);
    for (const b of reg.buildings) add(b.sprite, 'building', b.id);
    for (const n of reg.nodes) add(n.sprite, 'node', n.id);
  }

  function pages(primary: number): Texture[] {
    const list = pageTextures.get(primary) ?? [];
    pageTextures.set(primary, list);
    const a = atlas!;
    if (list.length === a.pages.length) return list;
    const ramp = teamRamp(primary);
    for (const pg of a.pages.slice(list.length)) {
      const canvas = document.createElement('canvas');
      canvas.width = pg.w;
      canvas.height = pg.h;
      const ctx = canvas.getContext('2d')!;
      const data = new Uint8ClampedArray(pg.rgba);
      for (const v of pg.team) {
        const i = (v >>> 4) * 4;
        const lv = (v & 15) * 3;
        data[i] = ramp[lv]!;
        data[i + 1] = ramp[lv + 1]!;
        data[i + 2] = ramp[lv + 2]!;
      }
      ctx.putImageData(new ImageData(data, pg.w, pg.h), 0, 0);
      // Crisp pixels when zoomed in, smooth when zoomed out.
      list.push(new Texture({ source: new CanvasSource({ resource: canvas, magFilter: 'nearest', minFilter: 'linear' }) }));
    }
    return list;
  }

  function tex(name: string, primary: number): Texture {
    const key = `${name}#${primary}`;
    const hit = entryTextures.get(key);
    if (hit !== undefined) return hit;
    const e = byName.get(name);
    if (e === undefined) return Texture.EMPTY;
    const page = pages(primary)[e.page]!;
    const t = new Texture({
      source: page.source,
      frame: new Rectangle(e.x, e.y, e.w, e.h),
      orig: new Rectangle(0, 0, e.fw, e.fh),
      trim: new Rectangle(e.tx, e.ty, e.w, e.h),
      label: name,
    });
    owned.push(t);
    entryTextures.set(key, t);
    return t;
  }

  const single = (t: Texture, top: number): SpriteAnimation => ({ frames: [t], frameMs: 0, mirrorX: false, modelTop: [Math.max(0, top)] });

  function buildingAsset(id: string, key: BuildingKey, primary: number): SpriteAsset {
    const anims = new Map<string, SpriteAnimation>();
    const probe = buildingFrame(key);
    const anim = (state: SpriteState, ctx?: SpriteContext): SpriteAnimation => {
      const stage: BuildingStage = state === 'foundation' || state === 'scaffold' ? state : 'complete';
      let look = lookFor(key, ctx?.age ?? 1);
      // A look still rendering in the background: show the earliest one until it arrives.
      const ready = byName.has(buildingSpriteName(look.id, stage));
      if (!ready) look = lookFor(key, 1);
      const k = `${look.id}|${stage}`;
      let a = anims.get(k);
      if (a === undefined) {
        const name = buildingSpriteName(look.id, stage);
        a = single(tex(name, primary), byName.get(name)?.top ?? 0);
        if (byName.has(name)) anims.set(k, a);
      }
      return a;
    };
    return {
      id,
      anchor: { x: probe.ax / probe.w, y: probe.ay / probe.h },
      states: STAGES,
      animation: (state, _facing, ctx) => anim(state, ctx),
    };
  }

  function unitAsset(id: string, key: UnitKey, primary: number): SpriteAsset {
    const table = new Map<string, SpriteAnimation>();
    const probe = byName.get(unitSpriteName(key, 'idle', 0, 0))!;
    for (const state of UNIT_STATES) {
      for (let f = 0; f < 8; f++) {
        const src = unitStateSource(key, state);
        const names = src === 'idle' ? [unitSpriteName(key, src, f, 0)] : [unitSpriteName(key, src, f, 0), unitSpriteName(key, src, f, 1)];
        table.set(`${state}|${f}`, {
          frames: names.map((n) => tex(n, primary)),
          frameMs: FRAME_MS[state],
          mirrorX: false,
          modelTop: names.map((n) => Math.max(0, byName.get(n)?.top ?? 0)),
        });
      }
    }
    return {
      id,
      anchor: { x: probe.ax / probe.fw, y: probe.ay / probe.fh },
      states: UNIT_STATES,
      animation: (state, facing: Facing) => {
        const st: UnitAnimState = state === 'walk' || state === 'work' || state === 'carry' ? state : 'idle';
        return table.get(`${st}|${facing & 7}`)!;
      },
    };
  }

  function nodeAsset(id: string, key: NodeKey): SpriteAsset {
    const n = NODE_VARIANTS[key];
    const anims: SpriteAnimation[] = [];
    for (let v = 0; v < n; v++) {
      const name = `node.${key}|${v}`;
      anims.push(single(tex(name, DEFAULT_PRIMARY), byName.get(name)?.top ?? 0));
    }
    const probe = byName.get(`node.${key}|0`)!;
    return {
      id,
      anchor: { x: probe.ax / probe.fw, y: probe.ay / probe.fh },
      states: ['default'],
      variants: n,
      animation: (_s, _f, ctx) => anims[ctx?.seed === undefined ? 0 : seedHash(ctx.seed) % n]!,
    };
  }

  function isKnown(id: string): boolean {
    const p = parseSpriteId(spriteAlias.get(id) ?? id);
    return p !== null && p.key !== null;
  }

  /** Known and rendered (some sprites arrive after load() from the background pass). */
  function isReady(id: string): boolean {
    const p = parseSpriteId(spriteAlias.get(id) ?? id);
    if (p === null || p.key === null || atlas === null) return false;
    if (p.kind === 'unit') return byName.has(unitSpriteName(p.key, 'idle', 0, 0));
    if (p.kind === 'building') return byName.has(buildingSpriteName(lookFor(p.key as BuildingKey, 1).id, 'complete'));
    return byName.has(`node.${p.key}|0`);
  }

  function realAsset(id: string, resolved: string, primary: number): SpriteAsset {
    const p = parseSpriteId(resolved)!;
    const ck = p.kind === 'node' ? resolved : `${resolved}#${primary}`;
    let a = assets.get(ck);
    if (a === undefined) {
      if (p.kind === 'building') a = buildingAsset(id, p.key as BuildingKey, primary);
      else if (p.kind === 'unit') a = unitAsset(id, p.key as UnitKey, primary);
      else a = nodeAsset(id, p.key as NodeKey);
      assets.set(ck, a);
    }
    return a;
  }

  /**
   * The asset for a known id. Callers keep assets (the entity layer holds one per entity), so an id whose sprites
   * are still rendering in the background gets an asset that delegates to the fallback art and switches to the
   * rendered sprites as soon as they arrive (the anchor follows, it is read again when the texture changes).
   */
  function teamSprite(id: SpriteId, primary: number, secondary: number): SpriteAsset {
    const resolved = spriteAlias.get(id) ?? id;
    const p = parseSpriteId(resolved);
    if (p === null || p.key === null) throw new Error(`rendered art has no sprite ${id}`);
    if (isReady(resolved)) return realAsset(id, resolved, primary);
    const lk = `lazy|${resolved}#${primary}`;
    const hit = assets.get(lk);
    if (hit !== undefined) return hit;
    const fb = options.fallback;
    let real: SpriteAsset | null = null;
    const current = (): SpriteAsset | null => {
      if (real === null && isReady(resolved)) real = realAsset(id, resolved, primary);
      return real ?? fb?.teamSprite(id, primary, secondary) ?? null;
    };
    const blank: SpriteAnimation = { frames: [Texture.EMPTY], frameMs: 0, mirrorX: false };
    const lazy: SpriteAsset = {
      id,
      get anchor() {
        return current()?.anchor ?? { x: 0.5, y: 1 };
      },
      get states() {
        return current()?.states ?? ['default'];
      },
      get variants() {
        return current()?.variants;
      },
      animation: (state, facing, ctx) => current()?.animation(state, facing, ctx) ?? blank,
    };
    assets.set(lk, lazy);
    return lazy;
  }

  /** Opaque pixels of an atlas entry (no shadow) as a canvas Surface for the icon painter. */
  function surfaceOf(name: string): Surface | null {
    if (surfaces.has(name)) return surfaces.get(name)!;
    const e = byName.get(name);
    if (e === undefined) return null;
    let s: Surface | null = null;
    if (e !== undefined && atlas !== null) {
      const pg = atlas.pages[e.page]!;
      const ramp = teamRamp(DEFAULT_PRIMARY);
      const teamAt = new Map<number, number>();
      for (const v of pg.team) teamAt.set(v >>> 4, v & 15);
      const data = new Uint8ClampedArray(e.w * e.h * 4);
      for (let y = 0; y < e.h; y++) {
        for (let x = 0; x < e.w; x++) {
          const si = (e.y + y) * pg.w + e.x + x;
          const di = (y * e.w + x) * 4;
          if (pg.rgba[si * 4 + 3]! < 255) continue;
          const lv = teamAt.get(si);
          data[di] = lv === undefined ? pg.rgba[si * 4]! : ramp[lv * 3]!;
          data[di + 1] = lv === undefined ? pg.rgba[si * 4 + 1]! : ramp[lv * 3 + 1]!;
          data[di + 2] = lv === undefined ? pg.rgba[si * 4 + 2]! : ramp[lv * 3 + 2]!;
          data[di + 3] = 255;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = e.w;
      canvas.height = e.h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.putImageData(new ImageData(data, e.w, e.h), 0, 0);
      s = { canvas, ctx, w: e.w / SS, h: e.h / SS };
    }
    surfaces.set(name, s);
    return s;
  }

  const iconSources: IconSources = {
    unit: (key) => surfaceOf(`icon.unit.${key}`),
    building: (key) => (BUILDING_IDS.includes(key as BuildingKey) ? surfaceOf(buildingSpriteName(lookFor(key as BuildingKey, 1).id, 'complete')) : null),
    node: (key) => surfaceOf(`node.${key}|0`),
  };

  function iconEntry(id: IconId): { surface: Surface; texture: Texture; url: string | null } {
    const hit = icons.get(id);
    if (hit !== undefined) return hit;
    const spec = parseIconId(id);
    let missing = false;
    const sources: IconSources = {
      unit: (k) => iconSources.unit(k) ?? ((missing = true), null),
      building: (k) => iconSources.building(k) ?? ((missing = true), null),
      node: (k) => iconSources.node(k) ?? ((missing = true), null),
    };
    const surface = drawIcon(spec, DEFAULT_TEAM, sources, ICON_THEMES);
    const texture = new Texture({ source: new CanvasSource({ resource: surface.canvas, resolution: SS }) });
    owned.push(texture);
    const e = { surface, texture, url: null as string | null };
    // An icon whose sprite is still rendering is drawn again once it arrives.
    if (!missing) icons.set(id, e);
    return e;
  }

  /** Add rendered sprites (a new set of pages) and terrain. */
  function add(a: Atlas, terrain: readonly TerrainTexOut[]): void {
    if (atlas === null) atlas = { pages: [], entries: [] };
    const base = atlas.pages.length;
    atlas.pages.push(...a.pages);
    for (const e of a.entries) {
      const moved = { ...e, page: e.page + base };
      atlas.entries.push(moved);
      byName.set(moved.name, moved);
    }
    if (terrain.length > 0) {
      const t = (k: string): Uint8ClampedArray => terrain.find((x) => x.kind === k)?.rgba ?? new Uint8ClampedArray(TEX_W * TEX_H * 4);
      terrainArt = { period: PERIOD, width: TEX_W, height: TEX_H, grass: t('grass'), grass2: t('grass2'), dry: t('dry'), dirt: t('dirt') };
      terrainTex = [...terrain];
    }
    for (const primary of pageTextures.keys()) pages(primary);
  }

  function collect(results: readonly { sprites: NamedSprite[]; terrain: TerrainTexOut | null }[]): { a: Atlas; terrain: TerrainTexOut[] } {
    const sprites: NamedSprite[] = [];
    const terrain: TerrainTexOut[] = [];
    for (const r of results) {
      sprites.push(...r.sprites);
      if (r.terrain !== null) terrain.push(r.terrain);
    }
    return { a: buildAtlas(sprites), terrain };
  }

  return {
    get report() {
      return report;
    },
    spriteNames: () => [...byName.keys()],
    opaquePixels(name: string): number {
      const e = byName.get(name);
      if (e === undefined || atlas === null) return -1;
      const pg = atlas.pages[e.page]!;
      let n = 0;
      for (let y = 0; y < e.h; y++) for (let x = 0; x < e.w; x++) if (pg.rgba[((e.y + y) * pg.w + e.x + x) * 4 + 3] === 255) n++;
      return n;
    },
    async load(onProgress?: LoadProgress): Promise<void> {
      if (atlas !== null) {
        onProgress?.(1);
        return;
      }
      const t0 = performance.now();
      const covered = options.covered;
      const jobs = allJobs().filter((j) => {
        const id = jobSprite(j);
        return id === null || covered === undefined || !covered(id);
      });
      const key = cacheKey(typeof __ART_HASH__ === 'string' ? __ART_HASH__ : 'dev', PALETTE_RGB, jobs);
      const cached = options.noCache === true ? null : await loadCached(key);
      if (cached !== null) {
        add(cached.atlas, cached.terrain);
        pages(DEFAULT_PRIMARY);
        onProgress?.(1);
        const ms = performance.now() - t0;
        report = { ms, msComplete: ms, complete: true, cached: true, workers: 0, mainThreadJobs: 0, sprites: cached.atlas.entries.length, pages: cached.atlas.pages.length };
        options.onReport?.(report);
        return;
      }
      const noWorkers = options.noWorkers === true;
      const first = jobs.filter(isEssential);
      const rest = jobs.filter((j) => !isEssential(j));
      const one = await runJobs(first, (f) => onProgress?.(f * 0.97), { noWorkers });
      const p1 = collect(one.results);
      add(p1.a, p1.terrain);
      pages(DEFAULT_PRIMARY);
      onProgress?.(1);
      const r: ArtLoadReport = {
        ms: performance.now() - t0,
        msComplete: null,
        complete: false,
        cached: false,
        workers: one.report.workers,
        mainThreadJobs: one.report.mainThreadJobs,
        sprites: p1.a.entries.length,
        pages: p1.a.pages.length,
      };
      report = r;
      // The rest renders in the background (workers, or main-thread slices) while the match runs.
      void runJobs(rest, () => {}, { noWorkers }).then((two) => {
        if (atlas === null) return;
        const p2 = collect(two.results);
        add(p2.a, p2.terrain);
        r.msComplete = performance.now() - t0;
        r.complete = true;
        r.sprites = atlas.entries.length;
        r.pages = atlas.pages.length;
        r.mainThreadJobs += two.report.mainThreadJobs;
        options.onReport?.(r);
        if (options.noCache !== true) void saveCached({ key, atlas: { pages: atlas.pages, entries: atlas.entries.map((e) => ({ ...e })) }, terrain: terrainTex });
      });
    },
    has: (id) => isKnown(id),
    sprite: (id) => teamSprite(id, DEFAULT_PRIMARY, 0),
    teamSprite,
    isFallback: (id) => !isKnown(id),
    isFallbackIcon: (id) => classifyIcon(id) === 'fallback',
    iconTexture: (id) => iconEntry(id).texture,
    iconUrl: (id) => {
      const e = iconEntry(id);
      e.url ??= e.surface.canvas.toDataURL('image/png');
      return e.url;
    },
    terrain: () => terrainArt,
    destroy(): void {
      for (const t of owned) t.destroy(false);
      for (const list of pageTextures.values()) for (const t of list) t.destroy(true);
      owned.length = 0;
      pageTextures.clear();
      entryTextures.clear();
      assets.clear();
      icons.clear();
      surfaces.clear();
      atlas = null;
    },
  };
}
