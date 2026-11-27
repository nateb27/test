/**
 * The decal and effect layer (PLAN-M2 7.2, WP27). Fed by `pushEvents` (a tick's sim events) and by what each frame's
 * state shows:
 *
 * - `UnitDied`: the unit's `death` animation plays once where it fell, in its owner's colour, then the body is held
 *   (`corpse`, else the last death frame) for 20 s of game time, fading over the last 3; at most 300 corpses.
 *   Art without a death animation tips its idle figure over instead.
 * - `BuildingDestroyed`: `rubble.<size>` for 60 s (fading over the last 3; at most 60) and clouds of `fx.dust`.
 * - Projectiles of `state.projectiles` (culled): arrows on a low arc rotated to their screen velocity, stones on a high
 *   arc, fire as a stream stretched from the nozzle to its head. One that disappears leaves `fx.hit` (arrow),
 *   `fx.dust` (stone) or `fx.splash` (fire) where it landed.
 * - A melee release (`lastAttackTick`) sparks `fx.hit` on the swing's target.
 * - Completed buildings below 66% hp burn and smoke (`damageOverlays`), depth-sorted with the entities.
 *
 * Every time is game time (`state.tick + alpha`), so pausing freezes the layer; corpses, rubble and effects are not in
 * state, so a loaded game starts without them (the layer clears itself when the state it draws is replaced or goes
 * back in time).
 */

import { Container, Sprite, type Texture } from 'pixi.js';
import type { DataRegistry } from '../../../data/schema';
import { rubbleSpriteId, type EffectSpriteId } from '../../art/catalog';
import { resolveUnitState, type AssetManifest, type SpriteAnimation, type SpriteAsset } from '../../art/manifest';
import type { TeamAssetManifest } from '../../art/procedural';
import { type EntityId, type Facing, type ReadonlyEntity, type ReadonlyGameState, type SimEvent } from '../../../sim/types';
import type { WorldPxRect } from '../camera';
import { spriteIdOf, teamLookup, type EntityLayer } from '../entities';
import { footprintCenter } from '../iso';
import {
  CORPSE_FADE_TICKS,
  CORPSE_TICKS,
  DecalStore,
  MAX_CORPSES,
  MAX_ONE_SHOTS,
  MAX_RUBBLE,
  RUBBLE_FADE_TICKS,
  RUBBLE_TICKS,
  TICK_MS,
  damageOverlays,
  decalAlpha,
  engagedTarget,
  fireCount,
  groundPoint,
  hash01,
  projectileView,
  type Decal,
  type OverlayKind,
} from './logic';

/** Counts reported by `WorldRendererApi.effectStats` (same shape as the renderer's `EffectStats`). */
export interface EffectCounts {
  projectiles: number;
  corpses: number;
  rubble: number;
  fires: number;
  effects: number;
}

interface Corpse extends Decal {
  readonly unitId: EntityId;
  readonly unitType: string;
  readonly x: number;
  readonly y: number;
  readonly facing: Facing;
  readonly primary: number;
  readonly secondary: number;
  asset: SpriteAsset | null;
  sprite: Sprite | null;
  shadow: Sprite | null;
}

interface Rubble extends Decal {
  readonly buildingId: EntityId;
  readonly size: number;
  readonly cx: number;
  readonly cy: number;
  sprite: Sprite | null;
}

interface OneShot {
  readonly id: EffectSpriteId;
  /** Screen position (world px at 1x). */
  readonly x: number;
  readonly y: number;
  readonly startMs: number;
  readonly scale: number;
  /** Draw depth (screen y of the ground point), so later effects of the same moment sit in front. */
  sprite: Sprite | null;
}

/** World unit vectors of the 8 facings (CLAUDE.md: 0=+x, 1=+x+y, 2=+y, 3=-x+y, 4=-x, 5=-x-y, 6=-y, 7=+x-y). */
const FACING_VEC: readonly [number, number][] = [
  [1, 0],
  [0.7071, 0.7071],
  [0, 1],
  [-0.7071, 0.7071],
  [-1, 0],
  [-0.7071, -0.7071],
  [0, -1],
  [0.7071, -0.7071],
];

/** Sprites reused frame to frame: `begin` marks all free, `take` hands one out, `end` hides the rest. */
class SpritePool {
  private sprites: Sprite[] = [];
  private used = 0;
  constructor(private readonly parent: Container) {}
  begin(): void {
    this.used = 0;
  }
  take(): Sprite {
    let s = this.sprites[this.used];
    if (s === undefined) {
      s = new Sprite();
      this.parent.addChild(s);
      this.sprites.push(s);
    }
    this.used++;
    s.visible = true;
    return s;
  }
  end(): void {
    for (let i = this.used; i < this.sprites.length; i++) {
      const s = this.sprites[i]!;
      if (s.visible) s.visible = false;
    }
  }
  /** Sprites handed out this frame. */
  get count(): number {
    return this.used;
  }
  destroy(): void {
    for (const s of this.sprites) s.destroy();
    this.sprites = [];
  }
}

function isTeamManifest(m: AssetManifest): m is TeamAssetManifest {
  return typeof (m as Partial<TeamAssetManifest>).teamSprite === 'function';
}

/** Frame of a timed animation `ms` after it started (looping or held at the last frame). */
function frameAt(anim: SpriteAnimation, ms: number): number {
  const n = anim.frames.length;
  if (n <= 1 || anim.frameMs <= 0) return 0;
  const i = Math.floor(Math.max(0, ms) / anim.frameMs);
  return anim.loop === false ? Math.min(n - 1, i) : i % n;
}

/** Total length (ms) of a one-shot animation. */
function lengthMs(anim: SpriteAnimation): number {
  return anim.frames.length * Math.max(1, anim.frameMs);
}

function setTexture(s: Sprite, t: Texture, ax: number, ay: number): void {
  if (s.texture !== t) s.texture = t;
  s.anchor.set(ax, ay);
}

export class EffectLayer {
  /** Corpses and rubble: on the ground, under every entity (added to the world below the entity container). */
  readonly decals = new Container();
  /** Projectiles and one-shot effects: above the entities. */
  readonly fx = new Container();
  private readonly corpses = new DecalStore<Corpse>(MAX_CORPSES);
  private readonly rubble = new DecalStore<Rubble>(MAX_RUBBLE);
  private oneShots: OneShot[] = [];
  private readonly projectilePool: SpritePool;
  private readonly firePool: SpritePool;
  private readonly assets = new Map<string, SpriteAsset>();
  /** Last frame's projectiles (id -> kind and landing point), to spawn impacts for the ones that are gone. */
  private seen = new Map<number, { kind: string; x: number; y: number }>();
  private seenTick = -1;
  private state: ReadonlyGameState | null = null;
  private lastTick = -1;
  /** Releases at or after this tick have not been sparked yet. */
  private hitsFrom: number | null = null;
  /** Events pushed before any state was drawn (stamped when the first one is). */
  private pending: SimEvent[] = [];
  private fires = 0;
  private firesTick = -1;
  private readonly meleeCache = new Map<string, boolean>();

  constructor(
    private readonly manifest: AssetManifest,
    private readonly registry: DataRegistry | null,
    private readonly entities: EntityLayer,
  ) {
    this.decals.sortableChildren = true;
    this.fx.sortableChildren = true;
    this.projectilePool = new SpritePool(this.fx);
    this.firePool = new SpritePool(entities.container);
  }

  private asset(id: string): SpriteAsset {
    let a = this.assets.get(id);
    if (a === undefined) {
      a = this.manifest.sprite(id);
      this.assets.set(id, a);
    }
    return a;
  }

  /** A tick's events (`Match.tick` calls this after every step that produced any). */
  pushEvents(events: readonly SimEvent[]): void {
    const s = this.state;
    if (s === null) {
      for (const e of events) if (e.type === 'UnitDied' || e.type === 'BuildingDestroyed') this.pending.push(e);
      return;
    }
    this.apply(events, s);
  }

  private apply(events: readonly SimEvent[], s: ReadonlyGameState): void {
    // The sim mutates one state object in place, so its tick is already the one after the step that emitted these.
    const tick = s.tick;
    const team = teamLookup(s, this.registry);
    for (const e of events) {
      if (e.type === 'UnitDied') {
        const c = team(e.playerId);
        this.corpses.add({
          tick,
          life: CORPSE_TICKS,
          fade: CORPSE_FADE_TICKS,
          unitId: e.unitId,
          unitType: e.unitType,
          x: e.x,
          y: e.y,
          facing: e.facing,
          primary: c.primary,
          secondary: c.secondary,
          asset: null,
          sprite: null,
          shadow: null,
        });
      } else if (e.type === 'BuildingDestroyed') {
        const c = footprintCenter(e.tx, e.ty, e.size);
        this.rubble.add({ tick, life: RUBBLE_TICKS, fade: RUBBLE_FADE_TICKS, buildingId: e.buildingId, size: e.size, cx: c.x, cy: c.y, sprite: null });
        // A collapse: dust from the middle and the corners of the footprint, a little apart in time.
        const start = tick * TICK_MS;
        const g = groundPoint(c.x, c.y);
        this.spawn('fx.dust', g.x, g.y, start, 0.9 + e.size * 0.35);
        for (let k = 0; k < 4; k++) {
          const ox = (k & 1 ? 1 : -1) * e.size * 0.3;
          const oy = (k & 2 ? 1 : -1) * e.size * 0.3;
          const p = groundPoint(c.x + ox, c.y + oy);
          this.spawn('fx.dust', p.x, p.y, start + 60 + k * 70, 0.6 + e.size * 0.2);
        }
      }
    }
    this.dropFreed();
  }

  private spawn(id: EffectSpriteId, x: number, y: number, startMs: number, scale = 1): void {
    this.oneShots.push({ id, x, y, startMs, scale, sprite: null });
    if (this.oneShots.length > MAX_ONE_SHOTS) {
      const old = this.oneShots.shift()!;
      old.sprite?.destroy();
    }
  }

  /** Destroy the sprites of decals the stores dropped (cap or expiry). */
  private dropFreed(): void {
    for (const c of this.corpses.drain()) {
      c.sprite?.destroy();
      c.shadow?.destroy();
      c.sprite = null;
      c.shadow = null;
    }
    for (const r of this.rubble.drain()) {
      r.sprite?.destroy();
      r.sprite = null;
    }
  }

  /** Forget everything (a loaded game, or a state from an earlier tick). */
  clear(): void {
    this.corpses.clear();
    this.rubble.clear();
    this.dropFreed();
    for (const o of this.oneShots) o.sprite?.destroy();
    this.oneShots = [];
    this.seen.clear();
    this.pending = [];
    this.hitsFrom = null;
    this.firesTick = -1;
  }

  /** Update every effect for this frame. `visible` is the viewport in world pixels. */
  update(state: ReadonlyGameState, alpha: number, visible: WorldPxRect): void {
    if (this.state !== null && (state !== this.state || state.tick < this.lastTick)) this.clear();
    this.state = state;
    if (this.pending.length > 0) {
      const p = this.pending;
      this.pending = [];
      this.apply(p, state);
    }
    const a = Math.min(1, Math.max(0, alpha));
    const t = state.tick + a;
    const nowMs = t * TICK_MS;
    const newTick = state.tick !== this.lastTick;
    const margin = 200;
    const minX = visible.minX - margin;
    const maxX = visible.maxX + margin;
    const minY = visible.minY - margin;
    const maxY = visible.maxY + margin;
    const inView = (x: number, y: number): boolean => x >= minX && x <= maxX && y >= minY && y <= maxY;

    if (newTick) {
      this.sparkReleases(state);
      this.impacts(state);
    }
    this.lastTick = state.tick;

    // Decals: expire, then draw (culled).
    this.corpses.prune(t);
    this.rubble.prune(t);
    this.dropFreed();
    for (const r of this.rubble.items()) this.drawRubble(r, t, inView);
    for (const c of this.corpses.items()) this.drawCorpse(c, t, inView);

    // Projectiles.
    this.projectilePool.begin();
    for (const pr of state.projectiles) {
      const v = projectileView(pr, a);
      if (!inView(v.x, v.y)) continue;
      const s = this.projectilePool.take();
      s.alpha = 1;
      s.zIndex = v.y;
      if (pr.kind === 'fire') {
        const anim = this.asset('projectile.fire').animation('default', 0);
        const tex = anim.frames[frameAt(anim, nowMs + pr.id * 37)]!;
        setTexture(s, tex, 0, 0.5);
        // A jet from the nozzle (hand height) to the head of the stream, near the ground.
        const src = groundPoint(pr.from.x, pr.from.y);
        const sx = src.x;
        const sy = src.y - 11;
        const hx = v.x;
        const hy = v.y - 4;
        const len = Math.sqrt((hx - sx) * (hx - sx) + (hy - sy) * (hy - sy));
        s.position.set(sx, sy);
        s.rotation = Math.atan2(hy - sy, hx - sx);
        s.scale.set(Math.max(0.25, len / Math.max(1, tex.width)), 1);
      } else {
        const anim = this.asset(pr.kind === 'arrow' ? 'projectile.arrow' : 'projectile.stone').animation('default', 0);
        setTexture(s, anim.frames[0]!, 0.5, 0.5);
        // Arrows and stones fly at chest height above their ground track.
        s.position.set(v.x, v.y - 10);
        s.rotation = pr.kind === 'arrow' ? v.angle : 0;
        s.scale.set(1, 1);
      }
    }
    this.projectilePool.end();

    // One-shot effects.
    let w = 0;
    for (const o of this.oneShots) {
      const anim = this.asset(o.id).animation('default', 0);
      const age = nowMs - o.startMs;
      if (age >= lengthMs(anim)) {
        o.sprite?.destroy();
        continue;
      }
      this.oneShots[w++] = o;
      const show = age >= 0 && inView(o.x, o.y);
      if (!show) {
        if (o.sprite !== null) o.sprite.visible = false;
        continue;
      }
      if (o.sprite === null) {
        o.sprite = new Sprite();
        this.fx.addChild(o.sprite);
      }
      const s = o.sprite;
      setTexture(s, anim.frames[frameAt(anim, age)]!, this.asset(o.id).anchor.x, this.asset(o.id).anchor.y);
      s.position.set(o.x, o.y);
      s.scale.set(o.scale, o.scale);
      s.zIndex = o.y + 0.5;
      s.visible = true;
    }
    this.oneShots.length = w;

    // Fire and smoke on damaged buildings (in the entity container, just in front of their building).
    this.firePool.begin();
    this.entities.forEachVisibleStatic((e, sx, sy, top, z) => {
      if (e.kind !== 'building' || !e.constructed || e.hp <= 0 || e.builtHp <= 0) return;
      const size = this.entities.footprint(e);
      const list = damageOverlays(e.id, size, e.hp / e.builtHp);
      if (list.length === 0) return;
      const height = top === null ? 18 + size * 14 : Math.max(12, sy - top);
      list.forEach((o, k) => {
        const s = this.firePool.take();
        const id: EffectSpriteId = OVERLAY_SPRITE[o.kind];
        const asset = this.asset(id);
        const anim = asset.animation('default', 0);
        setTexture(s, anim.frames[frameAt(anim, nowMs + hash01(e.id, 50 + k) * 1000)]!, asset.anchor.x, asset.anchor.y);
        const g = groundPoint(e.tile.tx + o.u * size, e.tile.ty + o.v * size);
        // Raise the point up the building's art; keep it inside the art's columns around the anchor.
        const lift = o.lift * height * 0.85;
        s.position.set(sx + (g.x - sx) * 0.75, g.y - lift);
        const scale = o.kind === 'smoke' ? 0.9 + size * 0.2 : o.kind === 'fireLarge' ? 0.8 + size * 0.1 : 1;
        s.scale.set(scale, scale);
        s.alpha = 1;
        // Smoke behind the flames, both just in front of the building and behind any unit standing in front of it.
        s.zIndex = z + (o.kind === 'smoke' ? 0.3 : 0.4 + k * 0.01);
      });
    });
    this.firePool.end();

    if (newTick || this.firesTick !== state.tick) this.countFires(state);
  }

  /** Spark `fx.hit` on the targets of melee releases since the last frame. */
  private sparkReleases(s: ReadonlyGameState): void {
    const from = this.hitsFrom ?? s.tick;
    this.hitsFrom = s.tick;
    const nowMs = s.tick * TICK_MS;
    for (const e of s.entities) {
      if (e.kind !== 'unit') continue;
      const lt = e.combat.lastAttackTick;
      if (lt === null || lt < from) continue;
      if (!this.isMelee(e.typeId)) continue;
      const start = (lt + 1) * TICK_MS;
      if (start + 300 < nowMs) continue; // long over (many ticks without a frame)
      const p = this.hitPoint(s, e);
      this.spawn('fx.hit', p.x, p.y, start, 1);
    }
  }

  private isMelee(typeId: string): boolean {
    let m = this.meleeCache.get(typeId);
    if (m === undefined) {
      const def = this.registry?.def(typeId);
      m = def !== undefined && def.kind === 'unit' ? def.combat.projectile === null : true;
      this.meleeCache.set(typeId, m);
    }
    return m;
  }

  /** Where a melee blow lands: the near edge of the target (body height), else just ahead of the attacker. */
  private hitPoint(s: ReadonlyGameState, u: Extract<ReadonlyEntity, { kind: 'unit' }>): { x: number; y: number } {
    const id = engagedTarget(u.currentOrder);
    const t = id === null ? undefined : findEntity(s, id);
    if (t !== undefined && t.kind === 'unit') {
      // Between the two, a little closer to the target.
      const g = groundPoint(u.pos.x + (t.pos.x - u.pos.x) * 0.7, u.pos.y + (t.pos.y - u.pos.y) * 0.7);
      return { x: g.x, y: g.y - 12 };
    }
    if (t !== undefined && t.kind === 'building') {
      const size = this.entities.footprint(t);
      const nx = Math.min(Math.max(u.pos.x, t.tile.tx), t.tile.tx + size);
      const ny = Math.min(Math.max(u.pos.y, t.tile.ty), t.tile.ty + size);
      const g = groundPoint(nx, ny);
      return { x: g.x, y: g.y - 14 };
    }
    const f = FACING_VEC[u.facing & 7]!;
    const g = groundPoint(u.pos.x + f[0] * 0.55, u.pos.y + f[1] * 0.55);
    return { x: g.x, y: g.y - 12 };
  }

  /** Impacts of the projectiles that were drawn last frame and are gone now. */
  private impacts(s: ReadonlyGameState): void {
    const now = new Map<number, { kind: string; x: number; y: number }>();
    for (const pr of s.projectiles) now.set(pr.id, { kind: pr.kind, x: pr.to.x, y: pr.to.y });
    const start = (s.tick - 1) * TICK_MS;
    // After a long run of steps without a frame the old landings are long over: no impacts for them.
    const fresh = this.seenTick >= 0 && s.tick - this.seenTick <= 3;
    for (const [id, p] of fresh ? this.seen : []) {
      if (now.has(id)) continue;
      const g = groundPoint(p.x, p.y);
      if (p.kind === 'arrow') this.spawn('fx.hit', g.x, g.y - 10, start, 0.8);
      else if (p.kind === 'stone') this.spawn('fx.dust', g.x, g.y, start, 0.75);
      else this.spawn('fx.splash', g.x, g.y, start, 1);
    }
    this.seen = now;
    this.seenTick = s.tick;
  }

  private drawRubble(r: Rubble, t: number, inView: (x: number, y: number) => boolean): void {
    const g = groundPoint(r.cx, r.cy);
    const vis = inView(g.x, g.y);
    if (!vis) {
      if (r.sprite !== null) r.sprite.visible = false;
      return;
    }
    const asset = this.asset(rubbleSpriteId(r.size));
    const anim = asset.animation('default', 0, { seed: r.buildingId });
    if (r.sprite === null) {
      r.sprite = new Sprite();
      this.decals.addChild(r.sprite);
    }
    const s = r.sprite;
    setTexture(s, anim.frames[0]!, asset.anchor.x, asset.anchor.y);
    s.position.set(g.x, g.y);
    // A footprint other than 2, 3 or 4 scales the nearest rubble.
    const k = r.size >= 2 && r.size <= 4 ? 1 : r.size / Math.min(4, Math.max(2, r.size));
    s.scale.set(k, k);
    s.alpha = decalAlpha(r, t);
    s.zIndex = -100000 + g.y;
    s.visible = true;
  }

  private corpseAsset(c: Corpse): SpriteAsset {
    if (c.asset === null) {
      const id = spriteIdOf(this.registry, { kind: 'unit', typeId: c.unitType } as ReadonlyEntity);
      c.asset = isTeamManifest(this.manifest) ? this.manifest.teamSprite(id, c.primary, c.secondary) : this.manifest.sprite(id);
    }
    return c.asset;
  }

  private drawCorpse(c: Corpse, t: number, inView: (x: number, y: number) => boolean): void {
    const g = groundPoint(c.x, c.y);
    if (!inView(g.x, g.y)) {
      if (c.sprite !== null) c.sprite.visible = false;
      if (c.shadow !== null) c.shadow.visible = false;
      return;
    }
    const asset = this.corpseAsset(c);
    const ageMs = (t - c.tick) * TICK_MS;
    const deathState = resolveUnitState(asset.states, 'death');
    let anim: SpriteAnimation;
    let idx: number;
    let tip = -1;
    if (deathState === 'death') {
      const death = asset.animation('death', c.facing);
      const i = death.frameMs > 0 ? Math.floor(ageMs / death.frameMs) : death.frames.length;
      if (i < death.frames.length) {
        anim = death;
        idx = Math.max(0, i);
      } else if (asset.states.includes('corpse')) {
        anim = asset.animation('corpse', c.facing);
        idx = 0;
      } else {
        anim = death;
        idx = death.frames.length - 1;
      }
    } else {
      // No death art: the idle figure tips over backwards in 0.4 s.
      anim = asset.animation(resolveUnitState(asset.states, 'idle'), c.facing);
      idx = 0;
      tip = Math.min(1, Math.max(0, ageMs / 400));
    }
    if (c.sprite === null) {
      c.sprite = new Sprite();
      this.decals.addChild(c.sprite);
    }
    const s = c.sprite;
    const tex = anim.frames[idx]!;
    setTexture(s, tex, asset.anchor.x, asset.anchor.y);
    s.position.set(g.x, g.y);
    const alpha = decalAlpha(c, t);
    s.alpha = alpha;
    s.zIndex = g.y;
    s.visible = true;
    const mirror = anim.mirrorX ? -1 : 1;
    if (tip >= 0) {
      const side = FACING_VEC[c.facing & 7]![0] - FACING_VEC[c.facing & 7]![1] > 0 ? -1 : 1;
      s.rotation = side * tip * 1.35;
      s.scale.set(mirror, 1 - 0.4 * tip);
      s.tint = tip >= 1 ? 0xb0aaa0 : 0xffffff;
    } else {
      s.rotation = 0;
      s.scale.set(mirror, 1);
      s.tint = 0xffffff;
    }
    const sh = anim.shadows?.[idx];
    if (sh === undefined) {
      if (c.shadow !== null) c.shadow.visible = false;
      return;
    }
    if (c.shadow === null) {
      c.shadow = new Sprite();
      this.decals.addChild(c.shadow);
    }
    const shadow = c.shadow;
    setTexture(shadow, sh, asset.anchor.x, asset.anchor.y);
    shadow.position.set(g.x, g.y);
    shadow.scale.set(mirror, 1);
    shadow.alpha = alpha;
    // Every corpse shadow under every corpse figure.
    shadow.zIndex = -50000 + g.y;
    shadow.visible = true;
  }

  private countFires(s: ReadonlyGameState): void {
    let n = 0;
    for (const e of s.entities) {
      if (e.kind !== 'building' || !e.constructed || e.hp <= 0 || e.builtHp <= 0) continue;
      n += fireCount(this.entities.footprint(e), e.hp / e.builtHp);
    }
    this.fires = n;
    this.firesTick = s.tick;
  }

  /** What the layer holds: projectiles in flight, corpses, rubble, burning fires (all buildings), live effects. */
  stats(): EffectCounts {
    const s = this.state;
    if (s !== null) {
      if (this.pending.length > 0) {
        const p = this.pending;
        this.pending = [];
        this.apply(p, s);
      }
      // Events may have arrived without a frame (steps without a redraw): expire by the state's tick.
      this.corpses.prune(s.tick);
      this.rubble.prune(s.tick);
      this.dropFreed();
      if (this.firesTick !== s.tick) this.countFires(s);
    }
    const pendingCorpses = this.pending.filter((e) => e.type === 'UnitDied').length;
    const pendingRubble = this.pending.length - pendingCorpses;
    return {
      projectiles: s?.projectiles.length ?? 0,
      corpses: this.corpses.size + pendingCorpses,
      rubble: this.rubble.size + pendingRubble,
      fires: this.fires,
      effects: this.oneShots.length,
    };
  }

  /** Sprites drawn on the last frame by this layer (tests and the draw-cost benchmark). */
  drawnCounts(): { projectiles: number; fires: number } {
    return { projectiles: this.projectilePool.count, fires: this.firePool.count };
  }

  destroy(): void {
    this.clear();
    this.projectilePool.destroy();
    this.firePool.destroy();
    this.decals.destroy({ children: true });
    this.fx.destroy({ children: true });
  }
}

const OVERLAY_SPRITE: Readonly<Record<OverlayKind, EffectSpriteId>> = { fireSmall: 'fx.fireSmall', fireLarge: 'fx.fireLarge', smoke: 'fx.smoke' };

function findEntity(s: ReadonlyGameState, id: EntityId): ReadonlyEntity | undefined {
  const list = s.entities;
  let lo = 0;
  let hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = list[mid]!.id;
    if (v === id) return list[mid]!;
    if (v < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return undefined;
}
