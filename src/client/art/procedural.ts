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
  BasicUnitState,
  SpriteContext,
} from './manifest';
import { buildingCanvasSize, drawBuilding } from './buildings';
import {
  allEffectSpriteIds,
  allIconIds,
  allSpriteIds,
  classifyIcon,
  classifySprite,
  iconFacing,
  isEffectSprite,
  parseIconId,
  parseSpriteId,
  type BuildingKey,
  type IconSpec,
  type NodeKey,
  type UnitKey,
} from './catalog';
import { ellipse, makeSurface, poly, SS, type Surface } from './draw';
import { drawEffect } from './fx';
import { drawIcon, type IconSources } from './icons';
import { NODE_SIZES, drawNode } from './nodes';
import { DEFAULT_PRIMARY, DEFAULT_SECONDARY, DEFAULT_TEAM, teamColors, type TeamColors } from './palette';
import { DRAWN_FACINGS, FACING_DIR, FACING_SOURCE, UNIT_SIZES, drawUnitFrame } from './units';

export type { TeamColors } from './palette';

/** Manifest with per-team colour variants and fallback introspection. */
export interface TeamAssetManifest extends AssetManifest {
  /** World sprite recoloured for a team (colours are 0xRRGGBB). Cached. Never throws. */
  teamSprite(id: SpriteId, primary: number, secondary: number): SpriteAsset;
  /** True when `id` has no drawing and the "?" fallback is used. */
  isFallback(id: SpriteId): boolean;
  /** True when `id` has no drawing and the "?" fallback icon is used. */
  isFallbackIcon(id: IconId): boolean;
  /**
   * Optional "art updated" signal: `listener` runs whenever sprites or icons arrive after `load()` resolved (the
   * rendered art's background pass), so a reader that cached URLs or textures (the HUD) can read them again. Returns
   * an unsubscribe function. Art that never changes after loading may leave it out.
   */
  onUpdate?(listener: () => void): () => void;
}

export interface ProceduralManifestOptions {
  /** Used to map def sprite/icon ids that do not follow the convention onto known drawings. */
  registry?: DataRegistry;
}

/** Unit states the procedural art draws: the four basic ones plus `attack` and `death` (PLAN-M2 7.2). */
type ProcUnitState = BasicUnitState | 'attack' | 'death';
const UNIT_STATES: readonly ProcUnitState[] = ['idle', 'walk', 'work', 'carry', 'attack', 'death'];
const BUILDING_STAGES: readonly BuildingStage[] = ['foundation', 'scaffold', 'complete'];
const FRAME_MS: Readonly<Record<ProcUnitState, number>> = { idle: 700, walk: 220, work: 280, carry: 240, attack: 150, death: 220 };
/** The attack's blow lands on its second frame (lean forward). */
const ATTACK_HIT_FRAME = 1;
const DEATH_FRAMES = 3;

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
    private readonly table: Readonly<Record<ProcUnitState, readonly SpriteAnimation[]>>,
  ) {}
  animation(state: SpriteState, facing: Facing): SpriteAnimation {
    const st: ProcUnitState = (UNIT_STATES as readonly string[]).includes(state) ? (state as ProcUnitState) : 'idle';
    return this.table[st][facing]!;
  }
}

/** An effect sprite (projectile, hit, fire, smoke, rubble): one animation, or one per variant chosen by the seed. */
class EffectSprite implements SpriteAsset {
  readonly states: readonly SpriteState[] = ['default'];
  readonly variants: number | undefined;
  constructor(
    readonly id: SpriteId,
    readonly anchor: { x: number; y: number },
    private readonly anims: readonly SpriteAnimation[],
  ) {
    this.variants = anims.length > 1 ? anims.length : undefined;
  }
  animation(_state: SpriteState, _facing: Facing, ctx?: SpriteContext): SpriteAnimation {
    const n = this.anims.length;
    return this.anims[ctx?.seed === undefined ? 0 : ((ctx.seed % n) + n) % n]!;
  }
}

/**
 * One frame of the procedural death (PLAN-M2 7.2: kneel, fall, lie), made from the bare idle figure: squashed onto its
 * knees, tipping over backwards and lying flat on the ground (the last frame is flattened into the iso ground plane and
 * darkened). Siege engines and horses tip less and collapse instead.
 */
function deathFrame(base: Surface, ax: number, ay: number, frame: number, fall: number, kind: 'human' | 'horse' | 'siege'): Surface {
  const s = makeSurface(base.w, base.h);
  const { ctx } = s;
  const rot = kind === 'siege' ? [0.06, 0.16, 0.24] : kind === 'horse' ? [0.18, 0.7, 1.2] : [0.22, 0.95, 1.5];
  const squash = kind === 'siege' ? [0.92, 0.78, 0.6] : [0.84, 0.9, 1];
  const flat = frame === 2 ? (kind === 'siege' ? 1 : 0.62) : 1;
  if (frame === 2) {
    ctx.save();
    ctx.globalAlpha = 0.28;
    ellipse(ctx, ax + fall * (kind === 'human' ? 9 : 14), ay, kind === 'human' ? 13 : 22, kind === 'human' ? 4 : 7, '#000', null);
    ctx.restore();
  }
  ctx.save();
  ctx.translate(ax, ay);
  ctx.scale(1, flat);
  ctx.rotate(fall * rot[frame]!);
  ctx.scale(1, squash[frame]!);
  ctx.translate(-ax, -ay);
  ctx.drawImage(base.canvas, 0, 0, base.w, base.h);
  ctx.restore();
  if (frame === 2) {
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, s.w, s.h);
    ctx.restore();
  }
  return s;
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
    const kind = key === 'batteringRam' || key === 'trebuchet' ? 'siege' : size.w > 100 ? 'horse' : 'human';
    const table = {} as Record<ProcUnitState, SpriteAnimation[]>;
    for (const state of UNIT_STATES) {
      const perFacing: (SpriteAnimation | undefined)[] = [];
      const base = new Map<Facing, Texture[]>();
      for (const f of DRAWN_FACINGS) {
        const frames: Texture[] = [];
        if (state === 'death') {
          const bare = makeSurface(size.w, size.h);
          drawUnitFrame({ ctx: bare.ctx, unit: key, facing: f, state: 'idle', frame: 0, team, bare: true });
          // Fall backwards: away from the facing on screen (to the right for the south view).
          const fall = FACING_DIR[f]!.x > 0.01 ? -1 : 1;
          for (let i = 0; i < DEATH_FRAMES; i++) frames.push(track(deathFrame(bare, size.ax, size.ay, i, fall, kind)));
        } else {
          for (const frame of [0, 1] as const) {
            const s = makeSurface(size.w, size.h);
            drawUnitFrame({ ctx: s.ctx, unit: key, facing: f, state, frame, team });
            frames.push(track(s));
          }
        }
        base.set(f, frames);
      }
      for (let f = 0; f < 8; f++) {
        const src = FACING_SOURCE[f]!;
        const frames = base.get(src.src)!;
        perFacing[f] = {
          frames,
          frameMs: FRAME_MS[state],
          mirrorX: src.mirror,
          ...(state === 'attack' ? { hitFrame: ATTACK_HIT_FRAME } : {}),
          ...(state === 'death' ? { loop: false } : {}),
        };
      }
      table[state] = perFacing as SpriteAnimation[];
    }
    return new UnitSprite(id, { x: size.ax / size.w, y: size.ay / size.h }, table);
  }

  function buildEffect(id: string): SpriteAsset {
    const art = drawEffect(id as Parameters<typeof drawEffect>[0]);
    const anims = art.frames.map((list): SpriteAnimation => ({ frames: list.map(track), frameMs: art.frameMs, mirrorX: false, loop: art.loop }));
    return new EffectSprite(id, art.anchor, anims);
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
    if (isEffectSprite(id)) {
      // Effects are not team coloured: one asset per id.
      let fx = spriteCache.get(id);
      if (fx === undefined) {
        fx = buildEffect(id);
        spriteCache.set(id, fx);
      }
      return fx;
    }
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
        // Mounted units are drawn side-on (facing 0): head-on, the horse is hidden behind its rider.
        const facing = iconFacing(key);
        drawUnitFrame({ ctx: s.ctx, unit: key as UnitKey, facing, state: 'idle', frame: 0, team: DEFAULT_TEAM });
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
      const sprites = [...allSpriteIds(), ...allEffectSpriteIds()];
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

