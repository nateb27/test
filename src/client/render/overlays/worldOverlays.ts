/**
 * World overlays (WP10): selection rings, drag box, construction/production
 * bars, carried-resource markers, rally flags and lines, order markers and the
 * placement ghost. Drawn into `renderer.layers.groundOverlays` (below
 * entities) and `.worldOverlays` (above), from sim state plus client state.
 *
 * Everything is sprite based and pooled: after warm-up a frame only writes
 * sprite properties. Only entities drawn on the last frame (already culled to
 * the viewport) are visited, plus the few selected buildings' rally points.
 */

import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import type { DataRegistry } from '../../../data/schema';
import { TILE_H, TILE_W, type CommandInput, type EntityId, type PlayerId, type Sim } from '../../../sim/types';
import type { AssetManifest, SpriteAsset } from '../../art/manifest';
import type { TeamAssetManifest } from '../../art/procedural';
import type { PlacementGhost } from '../../input/placement/types';
import { footprintOf } from '../entities';
import { worldToScreen } from '../iso';
import type { WorldRendererApi } from '../renderer';
import {
  barFor,
  buildingBarCentres,
  healthBarColor,
  healthBarFill,
  healthBarShown,
  healthBarSize,
  HP_FRAME,
  HP_UNIT_GAP,
  markerForCommand,
  markerLook,
  MarkerRing,
  MARKER_COLOR,
  MaxHpCache,
  MAX_MARKERS,
  RESOURCE_COLOR,
} from './logic';
import { SpritePool } from './pool';
import { OverlayTextures } from './textures';
import { UnitTopCache } from './unitTop';

const OWN_COLOR = 0x62ff7a;
const OTHER_COLOR = 0xffe27a;
const ENEMY_COLOR = 0xff6a5a;
const GHOST_OK = 0x5dff7a;
const GHOST_BAD = 0xff5a4a;
const RALLY_COLOR = 0xffe27a;
const BAR_W = 36;
const BAR_H = 5;
const CONSTRUCTION_COLOR = 0xffb347;
const PRODUCTION_COLOR = 0x5cc8ff;

export interface OverlayDeps {
  sim: Sim;
  renderer: WorldRendererApi;
  registry: DataRegistry;
  playerId: PlayerId;
  /** Selected entity ids, ascending. */
  selection(): readonly EntityId[];
  /** Current drag box in canvas px, or null. */
  dragBox(): { x0: number; y0: number; x1: number; y1: number } | null;
  /** Placement ghost of the active placement mode, or null. */
  ghost?(): PlacementGhost | null;
  /** For the building ghost's art. Without it only footprint tiles are drawn. */
  manifest?: AssetManifest;
  /** Millisecond clock (defaults to performance.now). */
  now?(): number;
}

function sortedHas(ids: readonly EntityId[], id: EntityId): boolean {
  let lo = 0;
  let hi = ids.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = ids[mid]!;
    if (v === id) return true;
    if (v < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
}

export class WorldOverlays {
  private readonly textures = new OverlayTextures();
  private readonly ground: Container;
  private readonly above: Container;
  private readonly tilePool: SpritePool;
  private readonly outlinePool: SpritePool;
  private readonly ringPool: SpritePool;
  private readonly rallyLinePool: SpritePool;
  private readonly markerPool: SpritePool;
  private readonly barPool: SpritePool;
  private readonly hpPool: SpritePool;
  private readonly maxHp: MaxHpCache;
  private readonly unitTops: UnitTopCache;
  private readonly carryPool: SpritePool;
  private readonly flagPool: SpritePool;
  private readonly ghostArt = new Sprite();
  private readonly ghostLabel = new Text({
    text: '',
    style: { fontFamily: 'system-ui, sans-serif', fontSize: 13, fontWeight: '600', fill: 0xffffff, stroke: { color: 0x101010, width: 3 } },
  });
  private readonly box = new Graphics();
  private readonly markers = new MarkerRing();
  private readonly now: () => number;
  /** Sprites drawn on the last update, per kind (tests and debugging). */
  readonly stats = { rings: 0, outlines: 0, bars: 0, healthBars: 0, carry: 0, flags: 0, markers: 0, ghostTiles: 0, markersAdded: 0 };
  private ghostSprite: { type: string; asset: SpriteAsset } | null = null;
  private labelText = '';
  private boxKey = '';

  constructor(private readonly deps: OverlayDeps) {
    this.now = deps.now ?? (() => performance.now());
    const { groundOverlays, worldOverlays } = deps.renderer.layers;
    this.ground = new Container();
    this.above = new Container();
    groundOverlays.addChild(this.ground);
    worldOverlays.addChild(this.above);
    // One child container per pool, in draw order (sprites are created lazily, so pools sharing a parent would interleave).
    const pool = (parent: Container): SpritePool => {
      const c = new Container();
      parent.addChild(c);
      return new SpritePool(c);
    };
    this.tilePool = pool(this.ground);
    this.outlinePool = pool(this.ground);
    this.rallyLinePool = pool(this.ground);
    this.markerPool = pool(this.ground);
    this.ringPool = pool(this.ground);
    this.ghostArt.visible = false;
    this.ghostLabel.visible = false;
    this.ghostLabel.anchor.set(0.5, 0);
    this.above.addChild(this.ghostArt);
    this.barPool = pool(this.above);
    this.hpPool = pool(this.above);
    this.unitTops = new UnitTopCache(deps.registry, deps.manifest);
    this.maxHp = new MaxHpCache((owner, typeId) => {
      try {
        return deps.sim.query.resolvedStat(owner, typeId, 'hp');
      } catch {
        const d = deps.registry.def(typeId);
        return d !== undefined && (d.kind === 'unit' || d.kind === 'building') ? d.combat.hp : 0;
      }
    });
    this.carryPool = pool(this.above);
    this.flagPool = pool(this.above);
    this.above.addChild(this.box, this.ghostLabel);
  }

  /** A command was just issued by the local player: show a marker where it points. */
  notifyCommand(cmd: CommandInput): void {
    const spec = markerForCommand(cmd, (id) => this.deps.sim.query.entityById(id), this.deps.registry);
    if (spec === null) return;
    this.markers.add(spec, this.now());
    this.stats.markersAdded++;
  }

  /** Redraw every overlay for the frame just rendered. Call after `renderer.render`. */
  update(): void {
    const { renderer, registry, playerId } = this.deps;
    const zoom = renderer.camera.zoom;
    const inv = 1 / zoom;
    const selection = this.deps.selection();
    const T = this.textures;

    this.tilePool.begin();
    this.outlinePool.begin();
    this.ringPool.begin();
    this.rallyLinePool.begin();
    this.markerPool.begin();
    this.barPool.begin();
    this.hpPool.begin();
    this.carryPool.begin();
    this.flagPool.begin();
    const players = this.deps.sim.state.players;

    for (const d of renderer.lastDrawn) {
      const selected = selection.length > 0 && sortedHas(selection, d.id);
      if (d.kind === 'node') {
        if (selected) {
          const e = this.deps.sim.query.entityById(d.id);
          if (e !== undefined) this.outline(d.wx, d.wy, footprintOf(registry, e), OTHER_COLOR);
        }
        continue;
      }
      const own = d.owner === playerId;
      if (d.kind === 'unit') {
        const sx = (d.wx - d.wy) * (TILE_W / 2);
        const sy = (d.wx + d.wy) * (TILE_H / 2);
        if (selected) {
          const r = this.ringPool.next(T.ring);
          r.position.set(sx, sy);
          r.tint = own ? OWN_COLOR : ENEMY_COLOR;
        }
        const e = this.deps.sim.query.entityById(d.id);
        if (e === undefined || e.kind !== 'unit') continue;
        const top = this.unitTops.top(e, d) ?? d.hit.minY;
        let carryX = sx;
        let carryY = d.hit.minY - 4;
        const max = this.maxHp.get(e.owner, e.typeId, players[e.owner]?.researched.length ?? 0);
        if (healthBarShown(e.hp, max, selected)) {
          const sz = healthBarSize('unit', 0);
          this.healthBar(sx, top - (HP_UNIT_GAP + sz.h / 2) * inv, e.hp, max, own, sz.w, sz.h, inv);
          carryX = sx + (sz.w / 2 + 6) * inv;
          carryY = top - (HP_UNIT_GAP + sz.h / 2) * inv;
        }
        if (own && e.carried !== null) {
          const c = this.carryPool.next(T.dot);
          c.position.set(carryX, carryY);
          c.tint = RESOURCE_COLOR[e.carried.type];
          c.scale.set(Math.min(1.8, Math.max(1, inv * 0.9)));
        }
        continue;
      }
      // building
      const e = this.deps.sim.query.entityById(d.id);
      if (e === undefined || e.kind !== 'building') continue;
      const size = footprintOf(registry, e);
      if (selected) this.outline(d.wx, d.wy, size, own ? OWN_COLOR : ENEMY_COLOR);
      const c = worldToScreen(d.wx, d.wy);
      const max = this.maxHp.get(e.owner, e.typeId, players[e.owner]?.researched.length ?? 0);
      // Just above the visible top of the art (sprite textures have empty rows above it; without a measurement
      // the footprint gives an estimate). The offsets are in world pixels so they scale with the building.
      const hasHp = healthBarShown(e.hp, max, selected);
      const bar = barFor(e, playerId);
      const ys = buildingBarCentres(c.y, d.top, size, e.constructed, inv, hasHp);
      if (hasHp && ys.health !== null) {
        const sz = healthBarSize('building', size);
        this.healthBar(c.x, ys.health, e.hp, max, own, sz.w, sz.h, inv);
      }
      if (bar !== null) this.bar(c.x, ys.progress, bar.fraction, bar.kind === 'construction' ? CONSTRUCTION_COLOR : PRODUCTION_COLOR, inv);
    }

    this.rallies(selection, inv);
    this.orderMarkers();
    this.placementGhost(inv);
    this.dragBoxGraphic();

    const st = this.stats;
    st.rings = this.ringPool.count;
    st.outlines = this.outlinePool.count;
    st.bars = this.barPool.count / 2;
    st.healthBars = this.hpPool.count / 2;
    st.carry = this.carryPool.count;
    st.flags = this.flagPool.count;
    st.markers = this.markerPool.count;
    st.ghostTiles = this.tilePool.count;
    this.tilePool.end();
    this.outlinePool.end();
    this.ringPool.end();
    this.rallyLinePool.end();
    this.markerPool.end();
    this.barPool.end();
    this.hpPool.end();
    this.carryPool.end();
    this.flagPool.end();
  }

  private outline(wx: number, wy: number, size: number, color: number): void {
    const s = worldToScreen(wx, wy);
    const o = this.outlinePool.next(this.textures.outline(Math.max(1, Math.round(size))));
    o.position.set(s.x, s.y);
    o.tint = color;
  }

  private bar(cx: number, y: number, fraction: number, color: number, inv: number): void {
    const w = BAR_W * inv;
    const h = BAR_H * inv;
    const bg = this.barPool.next(Texture.WHITE);
    bg.anchor.set(0, 0.5);
    bg.position.set(cx - w / 2 - inv, y);
    bg.width = w + 2 * inv;
    bg.height = h + 2 * inv;
    bg.tint = 0x0c0e08;
    bg.alpha = 0.85;
    const fg = this.barPool.next(Texture.WHITE);
    fg.anchor.set(0, 0.5);
    fg.position.set(cx - w / 2, y);
    fg.width = Math.max(inv, w * fraction);
    fg.height = h;
    fg.tint = color;
  }

  /** A health bar: dark frame (1 px all round, also the empty part) and the coloured fill. Sizes are screen px. */
  private healthBar(cx: number, y: number, hp: number, max: number, own: boolean, w: number, h: number, inv: number): void {
    const bg = this.hpPool.next(Texture.WHITE);
    bg.anchor.set(0, 0.5);
    bg.position.set(cx - (w / 2 + 1) * inv, y);
    bg.width = (w + 2) * inv;
    bg.height = (h + 2) * inv;
    bg.tint = HP_FRAME;
    bg.alpha = 0.9;
    const fg = this.hpPool.next(Texture.WHITE);
    fg.anchor.set(0, 0.5);
    fg.position.set(cx - (w / 2) * inv, y);
    fg.width = healthBarFill(hp, max, w) * inv;
    fg.height = h * inv;
    fg.tint = healthBarColor(hp, max, own);
  }

  private rallies(selection: readonly EntityId[], inv: number): void {
    const { renderer, registry, playerId } = this.deps;
    const T = this.textures;
    const view = renderer.camera.visibleRect();
    const pad = 200;
    for (const id of selection) {
      const e = this.deps.sim.query.entityById(id);
      if (e === undefined || e.kind !== 'building' || e.owner !== playerId || e.rally === null) continue;
      const size = footprintOf(registry, e);
      const a = worldToScreen(e.tile.tx + size / 2, e.tile.ty + size / 2);
      const b = worldToScreen(e.rally.x, e.rally.y);
      if (Math.max(a.x, b.x) < view.minX - pad || Math.min(a.x, b.x) > view.maxX + pad) continue;
      if (Math.max(a.y, b.y) < view.minY - pad || Math.min(a.y, b.y) > view.maxY + pad) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const line = this.rallyLinePool.next(Texture.WHITE);
      line.anchor.set(0, 0.5);
      line.position.set(a.x, a.y);
      line.rotation = Math.atan2(dy, dx);
      line.width = Math.hypot(dx, dy);
      line.height = 2 * inv;
      line.tint = RALLY_COLOR;
      line.alpha = 0.7;
      const flag = this.flagPool.next(T.flag);
      flag.anchor.set(3 / 18, 1);
      flag.position.set(b.x, b.y);
      flag.tint = RALLY_COLOR;
    }
  }

  private orderMarkers(): void {
    const now = this.now();
    for (let i = 0; i < MAX_MARKERS; i++) {
      const age = this.markers.age(i, now);
      if (age < 0) continue;
      const look = markerLook(age);
      const s = worldToScreen(this.markers.x[i]!, this.markers.y[i]!);
      const m = this.markerPool.next(this.textures.pulse);
      m.position.set(s.x, s.y);
      m.scale.set(look.scale);
      m.alpha = look.alpha;
      m.tint = MARKER_COLOR[this.markers.kind[i]!];
    }
  }

  private ghostAsset(type: string): SpriteAsset | null {
    if (this.deps.manifest === undefined) return null;
    if (this.ghostSprite?.type === type) return this.ghostSprite.asset;
    const def = this.deps.registry.def(type);
    if (def === undefined || def.kind !== 'building' || !this.deps.manifest.has(def.sprite)) return null;
    const m = this.deps.manifest as Partial<TeamAssetManifest> & AssetManifest;
    const color = this.deps.sim.state.players[this.deps.playerId]?.color;
    const asset = typeof m.teamSprite === 'function' && color !== undefined ? m.teamSprite(def.sprite, color, 0xd4af37) : m.sprite(def.sprite);
    this.ghostSprite = { type, asset };
    return asset;
  }

  private placementGhost(inv: number): void {
    const g = this.deps.ghost?.() ?? null;
    if (g === null || !g.visible) {
      this.ghostArt.visible = false;
      this.ghostLabel.visible = false;
      return;
    }
    const T = this.textures;
    const tint = g.ok ? GHOST_OK : GHOST_BAD;
    for (let i = 0; i < g.tileOk.length; i++) {
      const tx = g.tx + (i % g.size);
      const ty = g.ty + Math.floor(i / g.size);
      const s = worldToScreen(tx + 0.5, ty + 0.5);
      const t = this.tilePool.next(T.tile);
      t.position.set(s.x, s.y);
      t.tint = g.tileOk[i] === true ? GHOST_OK : GHOST_BAD;
      t.alpha = 0.6;
    }
    const c = worldToScreen(g.tx + g.size / 2, g.ty + g.size / 2);
    const o = this.outlinePool.next(T.outline(g.size));
    o.position.set(c.x, c.y);
    o.tint = tint;

    const asset = this.ghostAsset(g.buildingType);
    if (asset === null) {
      this.ghostArt.visible = false;
    } else {
      const anim = asset.animation('complete', 0, { age: this.deps.sim.state.players[this.deps.playerId]?.age ?? 1 });
      const art = this.ghostArt;
      art.visible = true;
      art.texture = anim.frames[0]!;
      art.anchor.set(asset.anchor.x, asset.anchor.y);
      art.position.set(c.x, c.y);
      art.tint = g.ok ? 0xd8ffd8 : 0xffb0a8;
      art.alpha = 0.55;
    }

    const text = g.ok ? '' : (g.reason ?? '');
    if (text !== this.labelText) {
      this.labelText = text;
      this.ghostLabel.text = text;
    }
    this.ghostLabel.visible = text.length > 0;
    if (text.length > 0) {
      const bottom = worldToScreen(g.tx + g.size, g.ty + g.size);
      this.ghostLabel.position.set(bottom.x, bottom.y + 6 * inv);
      this.ghostLabel.scale.set(inv);
    }
  }

  private dragBoxGraphic(): void {
    const b = this.deps.dragBox();
    const cam = this.deps.renderer.camera;
    if (b === null) {
      if (this.boxKey !== '') {
        this.boxKey = '';
        this.box.clear();
      }
      return;
    }
    const key = `${b.x0},${b.y0},${b.x1},${b.y1},${cam.x},${cam.y},${cam.zoom}`;
    if (key === this.boxKey) return;
    this.boxKey = key;
    const a = cam.canvasToWorldPx(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1));
    const c = cam.canvasToWorldPx(Math.max(b.x0, b.x1), Math.max(b.y0, b.y1));
    this.box
      .clear()
      .rect(a.x, a.y, c.x - a.x, c.y - a.y)
      .fill({ color: OWN_COLOR, alpha: 0.12 })
      .stroke({ width: 2 / cam.zoom, color: 0x0c0e08, alpha: 0.6 })
      .rect(a.x, a.y, c.x - a.x, c.y - a.y)
      .stroke({ width: 1 / cam.zoom, color: OWN_COLOR });
  }

  destroy(): void {
    for (const p of [this.tilePool, this.outlinePool, this.ringPool, this.rallyLinePool, this.markerPool, this.barPool, this.hpPool, this.carryPool, this.flagPool]) p.destroy();
    this.ghostArt.destroy();
    this.ghostLabel.destroy();
    this.box.destroy();
    this.ground.destroy();
    this.above.destroy();
    this.textures.destroy();
  }
}
