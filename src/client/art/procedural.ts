/**
 * The procedural AssetManifest (plan 6.1): draws every sprite and icon to
 * canvases at boot, uploads them as textures, and generates other teams'
 * colour variants lazily.
 *
 * Unknown ids never throw: `sprite()` / `iconTexture()` return a visible
 * magenta "?" fallback (`isFallback(id)` tells which).
 */

import { CanvasSource, Texture } from 'pixi.js';
import type { DataRegistry } from '../../data/schema';
import type { Facing } from '../../sim/types';
import type {
  AssetManifest,
  BuildingStage,
  IconId,
  LoadProgress,
  SpriteAnimation,
  SpriteAsset,
  SpriteId,
  SpriteState,
  UnitAnimState,
} from './manifest';
import { buildingCanvasSize, drawBuilding } from './buildings';
import {
  allIconIds,
  allSpriteIds,
  classifyIcon,
  classifySprite,
  parseIconId,
  parseSpriteId,
  type BuildingKey,
  type IconSpec,
  type NodeKey,
  type UnitKey,
} from './catalog';
import { makeSurface, poly, SS, type Surface } from './draw';
import { drawIcon, type IconSources } from './icons';
import { NODE_SIZES, drawNode } from './nodes';
import { DEFAULT_PRIMARY, DEFAULT_SECONDARY, DEFAULT_TEAM, teamColors, type TeamColors } from './palette';
import { DRAWN_FACINGS, FACING_SOURCE, UNIT_SIZES, drawUnitFrame } from './units';

export type { TeamColors } from './palette';

/** Manifest with per-team colour variants and fallback introspection. */
export interface TeamAssetManifest extends AssetManifest {
  /** World sprite recoloured for a team (colours are 0xRRGGBB). Cached. Never throws. */
  teamSprite(id: SpriteId, primary: number, secondary: number): SpriteAsset;
  /** True when `id` has no drawing and the "?" fallback is used. */
  isFallback(id: SpriteId): boolean;
  /** True when `id` has no drawing and the "?" fallback icon is used. */
  isFallbackIcon(id: IconId): boolean;
}

export interface ProceduralManifestOptions {
  /** Used to map def sprite/icon ids that do not follow the convention onto known drawings. */
  registry?: DataRegistry;
}

const UNIT_STATES: readonly UnitAnimState[] = ['idle', 'walk', 'work', 'carry'];
const BUILDING_STAGES: readonly BuildingStage[] = ['foundation', 'scaffold', 'complete'];
const FRAME_MS: Readonly<Record<UnitAnimState, number>> = { idle: 700, walk: 220, work: 280, carry: 240 };

function makeTexture(s: Surface): Texture {
  return new Texture({ source: new CanvasSource({ resource: s.canvas, resolution: SS }) });
}

function drawFallbackSprite(): Surface {
  const s = makeSurface(64, 64);
  const { ctx } = s;
  poly(ctx, [{ x: 32, y: 40 }, { x: 62, y: 54 }, { x: 32, y: 62 }, { x: 2, y: 54 }], '#8a1a74', '#fff', 1.5);
  ctx.fillStyle = '#ff4fd8';
  ctx.strokeStyle = '#1d1426';
  ctx.lineWidth = 3;
  ctx.fillRect(14, 6, 36, 40);
  ctx.strokeRect(14, 6, 36, 40);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 34px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('?', 32, 28);
  return s;
}

class StaticSprite implements SpriteAsset {
  readonly anim: SpriteAnimation;
  constructor(
    readonly id: SpriteId,
    readonly anchor: { x: number; y: number },
    readonly states: readonly SpriteState[],
    private readonly byState: Readonly<Record<string, SpriteAnimation>>,
  ) {
    this.anim = byState[states[0]!]!;
  }
  animation(state: SpriteState, _facing: Facing): SpriteAnimation {
    return this.byState[state] ?? this.anim;
  }
}

class UnitSprite implements SpriteAsset {
  readonly states: readonly SpriteState[] = UNIT_STATES;
  constructor(
    readonly id: SpriteId,
    readonly anchor: { x: number; y: number },
    /** [state][facing 0..7] */
    private readonly table: Readonly<Record<UnitAnimState, readonly SpriteAnimation[]>>,
  ) {}
  animation(state: SpriteState, facing: Facing): SpriteAnimation {
    const st: UnitAnimState = state === 'walk' || state === 'work' || state === 'carry' ? state : 'idle';
    return this.table[st][facing]!;
  }
}

export function createProceduralManifest(options: ProceduralManifestOptions = {}): TeamAssetManifest {
  const textures: Texture[] = [];
  const spriteCache = new Map<string, SpriteAsset>();
  const spriteAlias = new Map<string, string>();
  const iconAlias = new Map<string, string>();
  const iconCache = new Map<string, { surface: Surface; texture: Texture; url: string | null }>();
  const rawCache = new Map<string, Surface>();
  let fallbackSprite: SpriteAsset | null = null;
  let loaded = false;

  const track = (s: Surface): Texture => {
    const t = makeTexture(s);
    textures.push(t);
    return t;
  };

  // Map def ids that do not follow the id convention onto the drawings we have.
  const reg = options.registry;
  if (reg !== undefined) {
    const addSprite = (sprite: string, kind: string, defId: string): void => {
      if (classifySprite(sprite) === 'known') return;
      const canonical = `${kind}.${defId}`;
      if (classifySprite(canonical) === 'known') spriteAlias.set(sprite, canonical);
    };
    const addIcon = (icon: string, kind: string, defId: string): void => {
      if (classifyIcon(icon) === 'known') return;
      const canonical = `icon.${kind}.${defId}`;
      if (classifyIcon(canonical) !== 'fallback') iconAlias.set(icon, canonical);
    };
    for (const u of reg.units) {
      addSprite(u.sprite, 'unit', u.id);
      addIcon(u.icon, 'unit', u.id);
    }
    for (const b of reg.buildings) {
      addSprite(b.sprite, 'building', b.id);
      addIcon(b.icon, 'building', b.id);
    }
    for (const n of reg.nodes) {
      addSprite(n.sprite, 'node', n.id);
      addIcon(n.icon, 'node', n.id);
    }
    for (const t of reg.techs) addIcon(t.icon, 'tech', t.id);
  }

  const resolveSprite = (id: string): string => spriteAlias.get(id) ?? id;
  const resolveIcon = (id: string): string => iconAlias.get(id) ?? id;

  function buildUnit(id: string, key: UnitKey, team: TeamColors): SpriteAsset {
    const size = UNIT_SIZES[key];
    const table = {} as Record<UnitAnimState, SpriteAnimation[]>;
    for (const state of UNIT_STATES) {
      const perFacing: (SpriteAnimation | undefined)[] = [];
      const base = new Map<Facing, [Texture, Texture]>();
      for (const f of DRAWN_FACINGS) {
        const frames: Texture[] = [];
        for (const frame of [0, 1] as const) {
          const s = makeSurface(size.w, size.h);
          drawUnitFrame({ ctx: s.ctx, unit: key, facing: f, state, frame, team });
          frames.push(track(s));
        }
        base.set(f, [frames[0]!, frames[1]!]);
      }
      for (let f = 0; f < 8; f++) {
        const src = FACING_SOURCE[f]!;
        const frames = base.get(src.src)!;
        perFacing[f] = { frames, frameMs: FRAME_MS[state], mirrorX: src.mirror };
      }
      table[state] = perFacing as SpriteAnimation[];
    }
    return new UnitSprite(id, { x: size.ax / size.w, y: size.ay / size.h }, table);
  }

  function buildBuilding(id: string, key: BuildingKey, team: TeamColors): SpriteAsset {
    const size = buildingCanvasSize(key);
    const by: Record<string, SpriteAnimation> = {};
    for (const stage of BUILDING_STAGES) {
      const s = makeSurface(size.w, size.h);
      drawBuilding(s.ctx, key, team, stage);
      by[stage] = { frames: [track(s)], frameMs: 0, mirrorX: false };
    }
    return new StaticSprite(id, { x: size.cx / size.w, y: size.cy / size.h }, BUILDING_STAGES, by);
  }

  function buildNode(id: string, key: NodeKey): SpriteAsset {
    const size = NODE_SIZES[key];
    const s = makeSurface(size.w, size.h);
    drawNode(s.ctx, key);
    return new StaticSprite(id, { x: size.ax / size.w, y: size.ay / size.h }, ['default'], {
      default: { frames: [track(s)], frameMs: 0, mirrorX: false },
    });
  }

  function getFallback(): SpriteAsset {
    if (fallbackSprite === null) {
      const t = track(drawFallbackSprite());
      fallbackSprite = new StaticSprite('fallback', { x: 0.5, y: 0.85 }, ['default'], {
        default: { frames: [t], frameMs: 0, mirrorX: false },
      });
    }
    return fallbackSprite;
  }

  function teamSprite(id: SpriteId, primary: number, secondary: number): SpriteAsset {
    const resolved = resolveSprite(id);
    const parsed = parseSpriteId(resolved);
    if (parsed === null || parsed.key === null) return getFallback();
    const isNode = parsed.kind === 'node';
    const cacheKey = isNode ? resolved : `${resolved}|${primary}|${secondary}`;
    const hit = spriteCache.get(cacheKey);
    if (hit !== undefined) return hit;
    const team = primary === DEFAULT_PRIMARY && secondary === DEFAULT_SECONDARY ? DEFAULT_TEAM : teamColors(primary, secondary);
    let asset: SpriteAsset;
    if (parsed.kind === 'unit') asset = buildUnit(id, parsed.key as UnitKey, team);
    else if (parsed.kind === 'building') asset = buildBuilding(id, parsed.key as BuildingKey, team);
    else asset = buildNode(id, parsed.key as NodeKey);
    spriteCache.set(cacheKey, asset);
    return asset;
  }

  // Raw surfaces for icons (default team).
  const raw = (kind: string, key: string, make: () => Surface): Surface => {
    const k = `${kind}.${key}`;
    let s = rawCache.get(k);
    if (s === undefined) {
      s = make();
      rawCache.set(k, s);
    }
    return s;
  };
  const iconSources: IconSources = {
    unit: (key) =>
      raw('unit', key, () => {
        const size = UNIT_SIZES[key as UnitKey];
        const s = makeSurface(size.w, size.h);
        drawUnitFrame({ ctx: s.ctx, unit: key as UnitKey, facing: 1, state: 'idle', frame: 0, team: DEFAULT_TEAM });
        return s;
      }),
    building: (key) =>
      raw('building', key, () => {
        const size = buildingCanvasSize(key as BuildingKey);
        const s = makeSurface(size.w, size.h);
        drawBuilding(s.ctx, key as BuildingKey, DEFAULT_TEAM, 'complete');
        return s;
      }),
    node: (key) =>
      raw('node', key, () => {
        const size = NODE_SIZES[key as NodeKey];
        const s = makeSurface(size.w, size.h);
        drawNode(s.ctx, key as NodeKey);
        return s;
      }),
  };

  function iconEntry(id: IconId): { surface: Surface; texture: Texture; url: string | null } {
    const resolved = resolveIcon(id);
    const cached = iconCache.get(resolved);
    if (cached !== undefined) return cached;
    const spec: IconSpec | null = parseIconId(resolved);
    const surface = drawIcon(spec, DEFAULT_TEAM, iconSources);
    const entry = { surface, texture: track(surface), url: null as string | null };
    iconCache.set(resolved, entry);
    return entry;
  }

  const yieldToBrowser = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

  return {
    async load(onProgress?: LoadProgress): Promise<void> {
      if (loaded) {
        onProgress?.(1);
        return;
      }
      const sprites = allSpriteIds();
      const icons = allIconIds();
      const total = sprites.length + icons.length + 1;
      let done = 0;
      const step = async (): Promise<void> => {
        done++;
        onProgress?.(done / total);
        if (done % 3 === 0) await yieldToBrowser();
      };
      getFallback();
      await step();
      for (const id of sprites) {
        teamSprite(id, DEFAULT_PRIMARY, DEFAULT_SECONDARY);
        await step();
      }
      for (const id of icons) {
        iconEntry(id);
        await step();
      }
      loaded = true;
    },
    has: (id) => classifySprite(resolveSprite(id)) === 'known',
    sprite: (id) => teamSprite(id, DEFAULT_PRIMARY, DEFAULT_SECONDARY),
    teamSprite,
    isFallback: (id) => classifySprite(resolveSprite(id)) !== 'known',
    isFallbackIcon: (id) => classifyIcon(resolveIcon(id)) === 'fallback',
    iconTexture: (id) => iconEntry(id).texture,
    iconUrl: (id) => {
      const e = iconEntry(id);
      e.url ??= e.surface.canvas.toDataURL('image/png');
      return e.url;
    },
    destroy(): void {
      for (const t of textures) t.destroy(true);
      textures.length = 0;
      spriteCache.clear();
      iconCache.clear();
      rawCache.clear();
      fallbackSprite = null;
      loaded = false;
    },
  };
}

