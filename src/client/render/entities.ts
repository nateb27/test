/**
 * Entity layer: one Pixi sprite per visible entity, depth sorted, culled to
 * the viewport, with unit positions interpolated between ticks (plan 6).
 * Sprite ids and footprints come from the data registry by id at runtime and
 * fall back to the art catalogue when a definition is missing.
 */

import { Container, Sprite, type Texture } from 'pixi.js';
import type { DataRegistry } from '../../data/schema';
import type { AssetManifest, BuildingStage, SpriteAnimation, SpriteAsset, SpriteState, UnitAnimState } from '../art/manifest';
import type { TeamAssetManifest } from '../art/procedural';
import { DEFAULT_FOOTPRINT } from '../art/catalog';
import { DEFAULT_PRIMARY, DEFAULT_SECONDARY } from '../art/palette';
import {
  TILE_H,
  TILE_W,
  type DeepReadonly,
  type EntityId,
  type ReadonlyEntity,
  type ReadonlyGameState,
  type Vec2,
} from '../../sim/types';
import { perf } from '../debug/perf';
import type { WorldPxRect } from './camera';
import { compareDepth, depthKey, footprintCenter } from './iso';

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
  /** Footprint side in tiles (0 for units). Picking tests the ground footprint first. */
  size: number;
  /** Sprite hit box in world pixels (iso screen space at 1x): the body that overhangs the footprint. */
  hit: WorldPxRect;
  /** Sprite box in world pixels. */
  bounds: WorldPxRect;
  /**
   * World-pixel y of the highest visible pixel of the building or node sprite (the texture box has empty rows above the
   * art), or `null` when it cannot be measured. Overlays that sit on top of a building (progress bars) use it.
   */
  top: number | null;
  owner: number;
}

const opaqueTops = new WeakMap<Texture, number | null>();

/**
 * Empty rows at the top of a texture, in texture (world) pixels, found by scanning the canvas it was uploaded from.
 * `null` when the texture is not backed by a readable 2D canvas (the caller then falls back to an estimate).
 */
export function emptyRowsAbove(tex: Texture): number | null {
  const cached = opaqueTops.get(tex);
  if (cached !== undefined) return cached;
  let pad: number | null = null;
  try {
    const source = tex.source as unknown as { resource?: unknown; resolution?: number };
    const canvas = source.resource as { getContext?: (id: string) => unknown } | undefined;
    const ctx = typeof canvas?.getContext === 'function' ? (canvas.getContext('2d') as CanvasRenderingContext2D | null) : null;
    if (ctx !== null && ctx !== undefined) {
      const res = source.resolution ?? 1;
      const x = Math.round(tex.frame.x * res);
      const y = Math.round(tex.frame.y * res);
      const w = Math.max(1, Math.round(tex.frame.width * res));
      const h = Math.max(1, Math.round(tex.frame.height * res));
      const px = ctx.getImageData(x, y, w, h).data;
      for (let row = 0; row < h && pad === null; row++) {
        for (let col = 0; col < w; col++) {
          if (px[(row * w + col) * 4 + 3]! > 40) {
            pad = row / res;
            break;
          }
        }
      }
    }
  } catch {
    pad = null;
  }
  opaqueTops.set(tex, pad);
  return pad;
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

/**
 * What the layer keeps for one visible entity between frames: its sprite, its
 * art (looked up once, not per frame) and the `DrawnEntity` record handed to
 * picking and the overlays, updated in place.
 */
interface Entry {
  readonly e: ReadonlyEntity;
  readonly drawn: DrawnEntity;
  /** Anchor in world pixels (iso, 1x). Fixed for buildings and nodes, rewritten every frame for units. */
  sx: number;
  sy: number;
  /** Draw layer written to `sprite.zIndex` (see `EntityLayer.update`). */
  z: number;
  sprite: Sprite | null;
  asset: SpriteAsset | null;
  /** Last frame this entry was drawn (`EntityLayer.gen`), to hide it when it leaves the screen. */
  gen: number;
  /** Texture currently set on the sprite (statics skip the rest of the work while it is unchanged). */
  tex: Texture | null;
  mirror: boolean;
}

function newEntry(registry: DataRegistry | null, e: ReadonlyEntity): Entry {
  const size = e.kind === 'unit' ? 0 : footprintOf(registry, e);
  const a = e.kind === 'unit' ? e.pos : footprintCenter(e.tile.tx, e.tile.ty, size);
  const sx = (a.x - a.y) * (TILE_W / 2);
  const sy = (a.x + a.y) * (TILE_H / 2);
  const drawn: DrawnEntity = {
    id: e.id,
    kind: e.kind,
    depth: depthKey(a.x, a.y),
    wx: a.x,
    wy: a.y,
    size,
    hit: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    top: null,
    owner: e.owner,
  };
  return { e, drawn, sx, sy, z: 0, sprite: null, asset: null, gen: 0, tex: null, mirror: false };
}

/** `compareDepth` on entries. */
function byDepth(a: Entry, b: Entry): number {
  return a.drawn.depth - b.drawn.depth || a.drawn.id - b.drawn.id;
}

export class EntityLayer {
  readonly container = new Container();
  /** Buildings and nodes, ascending (depth, id). Their position never changes, so they are sorted once per change of the entity set. */
  private statics: Entry[] = [];
  private staticById = new Map<EntityId, Entry>();
  private staticSource: readonly unknown[] | null = null;
  private staticSourceLength = -1;
  private units = new Map<EntityId, Entry>();
  private gen = 0;
  /** Entities drawn on the last frame, back to front. */
  drawn: DrawnEntity[] = [];
  private drawnEntries: Entry[] = [];
  private visibleStatics: Entry[] = [];
  private visibleUnits: Entry[] = [];
  /** Players of the state being drawn (owner ages pick building looks). */
  private players: ReadonlyGameState['players'] = [];

  constructor(
    private readonly manifest: AssetManifest,
    private readonly registry: DataRegistry | null,
  ) {
    this.container.sortableChildren = true;
  }

  private assetFor(id: string, primary: number, secondary: number): SpriteAsset {
    return isTeamManifest(this.manifest) ? this.manifest.teamSprite(id, primary, secondary) : this.manifest.sprite(id);
  }

  /** Label of the texture an entity was drawn with on the last frame (debug and tests). */
  drawnTexture(id: EntityId): string | null {
    const entry = this.staticById.get(id) ?? this.units.get(id);
    return entry !== undefined && entry.gen === this.gen && entry.tex !== null ? (entry.tex.label ?? null) : null;
  }

  getDrawn(id: EntityId): DrawnEntity | undefined {
    const entry = this.staticById.get(id) ?? this.units.get(id);
    return entry !== undefined && entry.gen === this.gen ? entry.drawn : undefined;
  }

  /**
   * Rebuild the sorted list of buildings and nodes when the entity set changed.
   * Ids are never reused and `entities` stays ascending, so the set changed
   * exactly when the array was replaced (removals) or its length changed
   * (additions).
   */
  private syncStatics(state: ReadonlyGameState): void {
    const list = state.entities;
    if (list === this.staticSource && list.length === this.staticSourceLength) return;
    this.staticSource = list;
    this.staticSourceLength = list.length;
    const next: Entry[] = [];
    const live = new Set<EntityId>();
    for (const e of list) {
      if (e.kind === 'unit') continue;
      live.add(e.id);
      next.push(this.staticById.get(e.id) ?? newEntry(this.registry, e));
    }
    for (const [id, entry] of this.staticById) {
      if (!live.has(id)) {
        entry.sprite?.destroy();
        this.staticById.delete(id);
      }
    }
    for (const entry of next) this.staticById.set(entry.drawn.id, entry);
    next.sort(byDepth);
    // Buildings and nodes keep fixed even layers: Pixi re-sorts its children only when a zIndex changes.
    next.forEach((entry, i) => {
      entry.z = 2 * i;
    });
    this.statics = next;
  }

  /** Give `entry` its sprite and art on first use. */
  private ready(entry: Entry, colors: TeamColorLookup): void {
    if (entry.sprite === null) {
      entry.sprite = new Sprite();
      this.container.addChild(entry.sprite);
    }
    if (entry.asset === null) {
      const c = colors(entry.e.owner);
      entry.asset = this.assetFor(spriteIdOf(this.registry, entry.e), c.primary, c.secondary);
    }
  }

  /** Update the scene graph for `state`. `visible` is the viewport in world pixels. */
  update(state: ReadonlyGameState, alpha: number, visible: WorldPxRect, nowMs: number): void {
    this.gen++;
    const gen = this.gen;
    const margin = 260;
    const minX = visible.minX - margin;
    const minY = visible.minY - margin * 1.5;
    const maxX = visible.maxX + margin;
    const maxY = visible.maxY + margin;
    const a = Math.min(1, Math.max(0, alpha));
    const team = teamLookup(state, this.registry);
    this.players = state.players;

    this.syncStatics(state);

    // Visible buildings and nodes (already in draw order).
    const vs = this.visibleStatics;
    vs.length = 0;
    for (const entry of this.statics) {
      if (entry.sx < minX || entry.sx > maxX || entry.sy < minY || entry.sy > maxY) continue;
      vs.push(entry);
    }

    // Visible units, interpolated, then sorted among themselves.
    const vu = this.visibleUnits;
    vu.length = 0;
    for (const e of state.entities) {
      if (e.kind !== 'unit') continue;
      const x = e.prevPos.x + (e.pos.x - e.prevPos.x) * a;
      const y = e.prevPos.y + (e.pos.y - e.prevPos.y) * a;
      const sx = (x - y) * (TILE_W / 2);
      const sy = (x + y) * (TILE_H / 2);
      if (sx < minX || sx > maxX || sy < minY || sy > maxY) continue;
      let entry = this.units.get(e.id);
      if (entry === undefined) {
        entry = newEntry(this.registry, e);
        this.units.set(e.id, entry);
      }
      const d = entry.drawn;
      d.wx = x;
      d.wy = y;
      d.depth = depthKey(x, y);
      entry.sx = sx;
      entry.sy = sy;
      vu.push(entry);
    }
    vu.sort(byDepth);
    // A unit sits on the odd layer just below the first building or node drawn after it (in front of the one
    // before it), ordered among the units of the same gap by (depth, id): its layer changes only when it walks
    // past a building or node, not on every frame.
    {
      const stat = this.statics;
      let lastGap = -1;
      let run = 0;
      for (const unit of vu) {
        let lo = 0;
        let hi = stat.length;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          if (byDepth(stat[mid]!, unit) < 0) lo = mid + 1;
          else hi = mid;
        }
        run = lo === lastGap ? run + 1 : 1;
        lastGap = lo;
        unit.z = 2 * lo - 1 + Math.min(run, 1000) / 1024;
      }
    }

    // Merge the two sorted lists, assigning draw ranks.
    const order = this.drawnEntries;
    order.length = 0;
    const drawn = this.drawn;
    drawn.length = 0;
    let i = 0;
    let j = 0;
    while (i < vs.length || j < vu.length) {
      const entry = j >= vu.length || (i < vs.length && byDepth(vs[i]!, vu[j]!) <= 0) ? vs[i++]! : vu[j++]!;
      this.show(entry, team, nowMs);
      order.push(entry);
      drawn.push(entry.drawn);
    }

    // Hide what left the screen; forget what left the world.
    for (const entry of this.statics) {
      if (entry.gen !== gen && entry.sprite !== null && entry.sprite.visible) entry.sprite.visible = false;
    }
    for (const [id, entry] of this.units) {
      if (entry.gen === gen) continue;
      if (entry.sprite !== null) entry.sprite.visible = false;
      if (!entityExists(state, id)) {
        entry.sprite?.destroy();
        this.units.delete(id);
      }
    }
    perf.add('count.drawn', drawn.length);
  }

  /** Write one entity's sprite for this frame and refresh its `DrawnEntity`. */
  private show(entry: Entry, team: TeamColorLookup, nowMs: number): void {
    entry.gen = this.gen;
    this.ready(entry, team);
    const spr = entry.sprite as Sprite;
    const asset = entry.asset as SpriteAsset;
    const e = entry.e;
    let animState: SpriteState = 'default';
    if (e.kind === 'unit') animState = unitAnimState(e);
    else if (e.kind === 'building') animState = buildingStage(e);
    const anim: SpriteAnimation = asset.animation(animState, e.kind === 'unit' ? e.facing : 0, { age: this.players[e.owner]?.age ?? 1, seed: e.id });
    const frameIdx =
      anim.frames.length > 1 && anim.frameMs > 0 ? Math.floor((nowMs + e.id * 137) / anim.frameMs) % anim.frames.length : 0;
    const tex = anim.frames[frameIdx]!;
    const d = entry.drawn;
    const isUnit = e.kind === 'unit';
    // Buildings and nodes only need their sprite rewritten when the texture changed.
    if (isUnit || tex !== entry.tex || !spr.visible) {
      entry.tex = tex;
      spr.texture = tex;
      spr.anchor.set(asset.anchor.x, asset.anchor.y);
      // Nodes are mirrored for variety unless the art has its own variants (a mirror would flip a baked shadow).
      const mirror = e.kind === 'node' ? asset.variants === undefined && (e.id & 1) === 1 : anim.mirrorX;
      entry.mirror = mirror;
      spr.scale.x = mirror ? -1 : 1;
      spr.position.set(entry.sx, entry.sy);
      const w = tex.width;
      const h = tex.height;
      const b = d.bounds;
      b.minX = entry.sx - asset.anchor.x * w;
      b.minY = entry.sy - asset.anchor.y * h;
      b.maxX = entry.sx + (1 - asset.anchor.x) * w;
      b.maxY = entry.sy + (1 - asset.anchor.y) * h;
      if (isUnit) {
        const hw = w * 0.2;
        d.hit.minX = entry.sx - hw;
        d.hit.maxX = entry.sx + hw;
        d.hit.minY = entry.sy - h * 0.55;
        d.hit.maxY = entry.sy + h * 0.06;
      } else {
        d.hit = hitBox(e.kind, e.kind === 'node' ? e.typeId : '', b, { x: entry.sx, y: entry.sy }, w, h, d.size);
        // The art may say where its model starts (its texture can hold a taller look's frame, or a baked shadow).
        const modelTop = anim.modelTop?.[frameIdx];
        if (modelTop !== undefined) d.hit.minY = Math.max(d.hit.minY, b.minY + modelTop);
        if (e.kind === 'building') {
          const pad = modelTop ?? emptyRowsAbove(tex);
          d.top = pad === null ? null : b.minY + pad;
        }
      }
    }
    spr.zIndex = entry.z;
    spr.visible = true;
  }

  destroy(): void {
    this.statics = [];
    this.staticById.clear();
    this.units.clear();
    this.drawn = [];
    this.drawnEntries = [];
    this.visibleStatics = [];
    this.visibleUnits = [];
    this.staticSource = null;
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

/** Body of a node above its footprint that counts as the node: half width and height above the footprint centre, in px. */
const NODE_BODY: Readonly<Record<string, { halfW: number; up: number }>> = {
  tree: { halfW: 18, up: 64 },
  berryBush: { halfW: 22, up: 30 },
  goldDeposit: { halfW: 46, up: 44 },
  stoneDeposit: { halfW: 46, up: 44 },
};

/**
 * Click box for the part of a sprite that rises above its ground footprint
 * (the footprint itself is tested first, see `pickDrawn`).
 * Units: a body-sized box above the feet. Buildings: the sprite inside the
 * footprint's screen width, down to the footprint's front corner. Nodes: the
 * visible body (trunk and canopy, ore mass) in a narrow column, so open
 * ground beside or in front of a tree is not the tree.
 */
export function hitBox(kind: Drawable['kind'], typeId: string, bounds: WorldPxRect, anchor: { x: number; y: number }, w: number, h: number, size = 1): WorldPxRect {
  if (kind === 'unit') {
    const hw = w * 0.2;
    return { minX: anchor.x - hw, maxX: anchor.x + hw, minY: anchor.y - h * 0.55, maxY: anchor.y + h * 0.06 };
  }
  const front = anchor.y + size * (TILE_H / 2);
  if (kind === 'building') {
    const inx = w * 0.05;
    const band = size * (TILE_W / 2);
    return {
      minX: Math.max(bounds.minX + inx, anchor.x - band),
      maxX: Math.min(bounds.maxX - inx, anchor.x + band),
      minY: bounds.minY + 4,
      maxY: Math.min(bounds.maxY - 6, front),
    };
  }
  const body = NODE_BODY[typeId];
  if (body === undefined) {
    const inx = w * 0.22;
    return { minX: bounds.minX + inx, maxX: bounds.maxX - inx, minY: Math.max(bounds.minY + 3, anchor.y - 48), maxY: Math.min(bounds.maxY - 4, front) };
  }
  return { minX: anchor.x - body.halfW, maxX: anchor.x + body.halfW, minY: Math.max(bounds.minY + 3, anchor.y - body.up), maxY: front };
}
