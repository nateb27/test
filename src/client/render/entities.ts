/**
 * Entity layer: one Pixi sprite per visible entity, depth sorted, culled to
 * the viewport, with unit positions interpolated between ticks (plan 6).
 * Sprite ids and footprints come from the data registry by id at runtime and
 * fall back to the art catalogue when a definition is missing.
 */

import { Container, Sprite } from 'pixi.js';
import type { DataRegistry } from '../../data/schema';
import type { AssetManifest, BuildingStage, SpriteAnimation, SpriteAsset, SpriteState, UnitAnimState } from '../art/manifest';
import type { TeamAssetManifest } from '../art/procedural';
import { DEFAULT_FOOTPRINT } from '../art/catalog';
import { DEFAULT_PRIMARY, DEFAULT_SECONDARY } from '../art/palette';
import type {
  DeepReadonly,
  EntityId,
  ReadonlyEntity,
  ReadonlyGameState,
  Vec2,
} from '../../sim/types';
import type { WorldPxRect } from './camera';
import { compareDepth, depthKey, footprintCenter, worldToScreen } from './iso';

type RUnit = Extract<ReadonlyEntity, { kind: 'unit' }>;
type RBuilding = Extract<ReadonlyEntity, { kind: 'building' }>;

// ---------------------------------------------------------------------------
// Pure helpers (unit tested)
// ---------------------------------------------------------------------------

export function interpolate(prev: Vec2, cur: Vec2, alpha: number): Vec2 {
  const a = Math.min(1, Math.max(0, alpha));
  return { x: prev.x + (cur.x - prev.x) * a, y: prev.y + (cur.y - prev.y) * a };
}

/** The animation state implied by what a unit is doing. */
export function unitAnimState(u: DeepReadonly<RUnit>): UnitAnimState {
  const moving =
    Math.abs(u.pos.x - u.prevPos.x) + Math.abs(u.pos.y - u.prevPos.y) > 1e-6 ||
    (u.path !== null && u.path.nextIndex < u.path.waypoints.length);
  if (moving) return u.carried !== null ? 'carry' : 'walk';
  const o = u.currentOrder;
  if (o !== null) {
    if (o.type === 'gather' && o.phase === 'harvesting') return 'work';
    if ((o.type === 'build' || o.type === 'assist') && o.phase === 'building') return 'work';
  }
  return 'idle';
}

/** Construction stage drawn for a building. Under 30% progress it is a bare foundation. */
export function buildingStage(b: DeepReadonly<RBuilding>): BuildingStage {
  if (b.constructed) return 'complete';
  return b.progress < 0.3 ? 'foundation' : 'scaffold';
}

/** Footprint side (tiles) of an entity: registry def first, art catalogue default, then 1/2. */
export function footprintOf(registry: DataRegistry | null, e: ReadonlyEntity): number {
  if (e.kind === 'unit') return 0;
  const def = registry?.def(e.typeId);
  if (def !== undefined && (def.kind === 'building' || def.kind === 'node')) return def.footprint;
  return DEFAULT_FOOTPRINT[e.typeId] ?? (e.kind === 'building' ? 2 : 1);
}

/** Sprite id of an entity: registry def first, then the id convention. */
export function spriteIdOf(registry: DataRegistry | null, e: ReadonlyEntity): string {
  const def = registry?.def(e.typeId);
  if (def !== undefined && 'sprite' in def && typeof def.sprite === 'string' && def.sprite.length > 0) return def.sprite;
  return `${e.kind}.${e.typeId}`;
}

/** World anchor used for depth and screen placement (unit position / footprint centre). */
export function anchorOf(registry: DataRegistry | null, e: ReadonlyEntity, alpha: number): Vec2 {
  if (e.kind === 'unit') return interpolate(e.prevPos, e.pos, alpha);
  return footprintCenter(e.tile.tx, e.tile.ty, footprintOf(registry, e));
}

export interface Drawable {
  id: EntityId;
  kind: 'unit' | 'building' | 'node';
  /** `x + y` of the anchor. */
  depth: number;
  /** World anchor (tiles). */
  wx: number;
  wy: number;
}

export function makeDrawable(registry: DataRegistry | null, e: ReadonlyEntity, alpha: number): Drawable {
  const a = anchorOf(registry, e, alpha);
  return { id: e.id, kind: e.kind, depth: depthKey(a.x, a.y), wx: a.x, wy: a.y };
}

/** Back-to-front order (ascending depth, ties by id). Returns a new array. */
export function sortDrawables<T extends { depth: number; id: number }>(list: readonly T[]): T[] {
  return [...list].sort(compareDepth);
}

/** Priority for picking: lower wins. */
export const KIND_PRIORITY: Readonly<Record<Drawable['kind'], number>> = { unit: 0, building: 1, node: 2 };

// ---------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------

/** What the layer remembers about each entity drawn on the last frame (for picking). */
export interface DrawnEntity extends Drawable {
  /** Hit box in world pixels (iso screen space at 1x). */
  hit: WorldPxRect;
  /** Sprite box in world pixels. */
  bounds: WorldPxRect;
  owner: number;
}

interface View {
  sprite: Sprite;
  gen: number;
}

function isTeamManifest(m: AssetManifest): m is TeamAssetManifest {
  return typeof (m as Partial<TeamAssetManifest>).teamSprite === 'function';
}

export interface TeamColorLookup {
  (owner: number): { primary: number; secondary: number };
}

export function teamLookup(state: ReadonlyGameState, registry: DataRegistry | null): TeamColorLookup {
  return (owner) => {
    const p = state.players[owner];
    const civ = p?.civ === null || p?.civ === undefined ? undefined : registry?.civs.find((c) => c.id === p.civ);
    return {
      primary: p !== undefined && owner !== 0 ? p.color : DEFAULT_PRIMARY,
      secondary: civ?.palette.secondary ?? DEFAULT_SECONDARY,
    };
  };
}

export class EntityLayer {
  readonly container = new Container();
  private views = new Map<EntityId, View>();
  private gen = 0;
  /** Entities drawn on the last frame, back to front. */
  drawn: DrawnEntity[] = [];
  private byId = new Map<EntityId, DrawnEntity>();

  constructor(
    private readonly manifest: AssetManifest,
    private readonly registry: DataRegistry | null,
  ) {
    this.container.sortableChildren = true;
  }

  private assetFor(id: string, primary: number, secondary: number): SpriteAsset {
    return isTeamManifest(this.manifest) ? this.manifest.teamSprite(id, primary, secondary) : this.manifest.sprite(id);
  }

  getDrawn(id: EntityId): DrawnEntity | undefined {
    return this.byId.get(id);
  }

  /** Update the scene graph for `state`. `visible` is the viewport in world pixels. */
  update(state: ReadonlyGameState, alpha: number, visible: WorldPxRect, nowMs: number): void {
    this.gen++;
    const margin = 260;
    const rect = { minX: visible.minX - margin, minY: visible.minY - margin * 1.5, maxX: visible.maxX + margin, maxY: visible.maxY + margin };
    const team = teamLookup(state, this.registry);
    const list: { d: Drawable; e: ReadonlyEntity }[] = [];
    for (const e of state.entities) {
      const d = makeDrawable(this.registry, e, alpha);
      const s = worldToScreen(d.wx, d.wy);
      if (s.x < rect.minX || s.x > rect.maxX || s.y < rect.minY || s.y > rect.maxY) continue;
      list.push({ d, e });
    }
    list.sort((a, b) => compareDepth(a.d, b.d));

    this.drawn = [];
    this.byId.clear();
    list.forEach(({ d, e }, rank) => {
      let view = this.views.get(e.id);
      if (view === undefined) {
        view = { sprite: new Sprite(), gen: 0 };
        this.container.addChild(view.sprite);
        this.views.set(e.id, view);
      }
      view.gen = this.gen;
      const spr = view.sprite;
      const colors = team(e.owner);
      const asset = this.assetFor(spriteIdOf(this.registry, e), colors.primary, colors.secondary);
      let state_: SpriteState = 'default';
      if (e.kind === 'unit') state_ = unitAnimState(e);
      else if (e.kind === 'building') state_ = buildingStage(e);
      const anim: SpriteAnimation = asset.animation(state_, e.kind === 'unit' ? e.facing : 0);
      const frameIdx = anim.frames.length > 1 && anim.frameMs > 0 ? Math.floor((nowMs + e.id * 137) / anim.frameMs) % anim.frames.length : 0;
      const tex = anim.frames[frameIdx]!;
      spr.texture = tex;
      spr.anchor.set(asset.anchor.x, asset.anchor.y);
      const mirror = e.kind === 'node' ? (e.id & 1) === 1 : anim.mirrorX;
      spr.scale.x = mirror ? -1 : 1;
      const s = worldToScreen(d.wx, d.wy);
      spr.position.set(s.x, s.y);
      spr.zIndex = rank;
      spr.visible = true;

      const w = tex.width;
      const h = tex.height;
      const bounds: WorldPxRect = {
        minX: s.x - asset.anchor.x * w,
        minY: s.y - asset.anchor.y * h,
        maxX: s.x + (1 - asset.anchor.x) * w,
        maxY: s.y + (1 - asset.anchor.y) * h,
      };
      const drawn: DrawnEntity = { ...d, bounds, hit: hitBox(e.kind, e.kind === 'node' ? e.typeId : '', bounds, s, w, h), owner: e.owner };
      this.drawn.push(drawn);
      this.byId.set(e.id, drawn);
    });

    for (const [id, view] of this.views) {
      if (view.gen !== this.gen) {
        // Entity left the screen or the world: hide, and free it entirely if it no longer exists.
        view.sprite.visible = false;
        if (!entityExists(state, id)) {
          view.sprite.destroy();
          this.views.delete(id);
        }
      }
    }
  }

  destroy(): void {
    this.views.clear();
    this.drawn = [];
    this.byId.clear();
  }
}

function entityExists(state: ReadonlyGameState, id: EntityId): boolean {
  // `entities` is sorted by id: binary search.
  let lo = 0;
  let hi = state.entities.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = state.entities[mid]!.id;
    if (v === id) return true;
    if (v < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
}

/**
 * Tighter click box than the full texture (textures include shadow and padding).
 * Units: a body-sized box above the feet; buildings: texture minus a small inset;
 * nodes: trees only the canopy column, deposits/bushes the central mass.
 */
export function hitBox(kind: Drawable['kind'], typeId: string, bounds: WorldPxRect, anchor: { x: number; y: number }, w: number, h: number): WorldPxRect {
  if (kind === 'unit') {
    const hw = w * 0.2;
    return { minX: anchor.x - hw, maxX: anchor.x + hw, minY: anchor.y - h * 0.55, maxY: anchor.y + h * 0.06 };
  }
  if (kind === 'building') {
    const inx = w * 0.05;
    return { minX: bounds.minX + inx, maxX: bounds.maxX - inx, minY: bounds.minY + 4, maxY: bounds.maxY - 6 };
  }
  const inx = typeId === 'tree' ? w * 0.22 : w * 0.1;
  return { minX: bounds.minX + inx, maxX: bounds.maxX - inx, minY: bounds.minY + 3, maxY: bounds.maxY - 4 };
}

