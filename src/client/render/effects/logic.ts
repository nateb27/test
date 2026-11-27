/**
 * Pure rules of the effect layer (PLAN-M2 7.2, WP27), kept free of Pixi so they are unit tested: the attack animation
 * timing synchronised with the sim's wind-up and release, projectile flight positions and arcs, the building damage
 * overlays by hp fraction, and the capped, game-time decal store behind corpses and rubble.
 *
 * All times are game time: ticks (`state.tick`, plus the render `alpha` within a tick). Nothing reads a wall clock, so
 * a paused match is a still picture and the game speed drives every effect.
 */

import type { ProjectileKind, ReadonlyGameState } from '../../../sim/types';
import { TICK_RATE } from '../../../sim/types';
import { HEIGHT_PX, worldToScreenZ, type ScreenPoint } from '../iso';

type ROrder = NonNullable<Extract<ReadonlyGameState['entities'][number], { kind: 'unit' }>['currentOrder']>;

/** Ticks the attack animation keeps playing after a release (the recovery frames). */
export const ATTACK_ANIM_TAIL_TICKS = 8;
/** A corpse lies for 20 s of game time and fades over its last 3 s; at most 300 (the oldest go first). */
export const CORPSE_TICKS = 20 * TICK_RATE;
export const CORPSE_FADE_TICKS = 3 * TICK_RATE;
export const MAX_CORPSES = 300;
/** Rubble stays 60 s of game time (fading over the last 3 s); at most 60. */
export const RUBBLE_TICKS = 60 * TICK_RATE;
export const RUBBLE_FADE_TICKS = 3 * TICK_RATE;
export const MAX_RUBBLE = 60;
/** A hit unit flashes white for 2 ticks at 40% alpha. */
export const FLASH_TICKS = 2;
export const FLASH_ALPHA = 0.4;
/** One-shot effects alive at once (hits, impacts, dust); the oldest go first. */
export const MAX_ONE_SHOTS = 400;
/** Arc heights of projectiles in tiles (fire flies flat). */
export const ARC_HEIGHT: Readonly<Record<ProjectileKind, number>> = { arrow: 0.4, stone: 1.5, fire: 0 };
/** Milliseconds of game time per tick (animation frames are timed in ms). */
export const TICK_MS = 1000 / TICK_RATE;

/** `max(1, round(windup * TICK_RATE))`, the sim's wind-up in ticks (PLAN-M2 3.5). */
export function windupTicksOf(windupSeconds: number): number {
  return Math.max(1, Math.round(windupSeconds * TICK_RATE));
}

export interface AttackTiming {
  windup: number;
  lastAttackTick: number | null;
}

/**
 * Progress of the attack animation in [0, 1] of the whole swing, or null when the unit is not attacking. The blow
 * (the release tick) is at exactly `hitAt` = windup / (windup + tail) of the way: during the wind-up the elapsed time
 * is `windupTicks - windup + alpha`; after the release it is `windupTicks` plus the ticks since the release.
 */
export function attackPhase(c: AttackTiming, tick: number, alpha: number, windupTicks: number): { elapsed: number; released: boolean } | null {
  const a = Math.min(1, Math.max(0, alpha));
  if (c.windup > 0) return { elapsed: Math.min(windupTicks, Math.max(0, windupTicks - c.windup + a)), released: false };
  if (c.lastAttackTick === null) return null;
  // `lastAttackTick` is the tick whose step released; the state shown is after that step (tick = lastAttackTick + 1).
  const since = tick - 1 - c.lastAttackTick + a;
  if (since < 0 || since >= ATTACK_ANIM_TAIL_TICKS) return null;
  return { elapsed: windupTicks + since, released: true };
}

/**
 * The attack frame: frames `0..hitFrame` are spread over the wind-up so the blow frame coincides with the release
 * tick, the remaining frames over the tail.
 */
export function attackFrame(c: AttackTiming, tick: number, alpha: number, windupTicks: number, frames: number, hitFrame: number): number | null {
  const p = attackPhase(c, tick, alpha, windupTicks);
  if (p === null) return null;
  const n = Math.max(1, frames);
  const hit = Math.max(0, Math.min(n - 1, hitFrame));
  if (!p.released) return Math.min(hit, Math.floor((p.elapsed / Math.max(1, windupTicks)) * hit + 1e-9));
  const since = p.elapsed - windupTicks;
  return Math.min(n - 1, hit + Math.floor((since / ATTACK_ANIM_TAIL_TICKS) * (n - hit)));
}

/** Target an attacking unit is engaged with (for the hit spark), or null. Mirrors the sim's engagement rule. */
export function engagedTarget(o: ROrder | null): number | null {
  if (o === null) return null;
  if (o.type === 'attack') return o.targetId;
  if (o.type === 'attackMove') return o.phase === 'engaging' ? o.targetId : null;
  if (o.type === 'hold') return o.targetId;
  return null;
}

/** How strongly a unit damaged at `lastDamagedTick` flashes now (0 = not at all). */
export function flashAlpha(lastDamagedTick: number | null, tick: number, alpha: number): number {
  if (lastDamagedTick === null) return 0;
  const since = tick - 1 - lastDamagedTick + Math.min(1, Math.max(0, alpha));
  return since >= 0 && since < FLASH_TICKS ? FLASH_ALPHA : 0;
}

export interface FlightView {
  /** Screen position (world px at 1x) of the projectile. */
  x: number;
  y: number;
  /** Screen-space angle of its velocity (radians, 0 = +x on screen). */
  angle: number;
  /** Flight progress in [0, 1]. */
  p: number;
}

interface FlightLike {
  kind: ProjectileKind;
  from: { x: number; y: number };
  to: { x: number; y: number };
  flightTicks: number;
  ticksLeft: number;
}

/**
 * Where a projectile is drawn (PLAN-M2 2.4): `lerp(from, to, p)` with `p = 1 - (ticksLeft - alpha) / flightTicks`,
 * lifted by the arc `4 H p (1 - p)` (arrow H 0.4 tiles, stone 1.5, fire flat), rotated to its screen velocity.
 */
export function projectileView(pr: FlightLike, alpha: number): FlightView {
  const f = Math.max(1, pr.flightTicks);
  const p = Math.min(1, Math.max(0, 1 - (pr.ticksLeft - Math.min(1, Math.max(0, alpha))) / f));
  const h = ARC_HEIGHT[pr.kind];
  const wx = pr.from.x + (pr.to.x - pr.from.x) * p;
  const wy = pr.from.y + (pr.to.y - pr.from.y) * p;
  const s = worldToScreenZ(wx, wy, 4 * h * p * (1 - p));
  const dx = pr.to.x - pr.from.x;
  const dy = pr.to.y - pr.from.y;
  // Screen velocity per unit of p: the ground part plus the arc's height change.
  const vx = (dx - dy) * 32;
  const vy = (dx + dy) * 16 - 4 * h * (1 - 2 * p) * HEIGHT_PX;
  return { x: s.x, y: s.y, angle: vx === 0 && vy === 0 ? 0 : Math.atan2(vy, vx), p };
}

/** Screen point of a world point (ground). */
export function groundPoint(x: number, y: number): ScreenPoint {
  return worldToScreenZ(x, y, 0);
}

export type OverlayKind = 'fireSmall' | 'fireLarge' | 'smoke';

export interface DamageOverlay {
  kind: OverlayKind;
  /** Position inside the footprint, fractions of its side (within [0.18, 0.82]). */
  u: number;
  v: number;
  /** How high up the building's art (0 = ground at that point, 1 = the top of the art). */
  lift: number;
}

/** Stable hash of (id, k) to [0, 1). */
export function hash01(id: number, k: number): number {
  let h = Math.imul((id | 0) ^ Math.imul(k + 1, 0x27d4eb2d), 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/**
 * Fire and smoke on a completed building by hp fraction (PLAN-M2 7.2): below 66% one small fire and smoke; below 33%
 * large fires at 2 points (3 for a footprint of 4) plus smoke. Points come from a hash of the building id, so they do
 * not move between frames or after loading.
 */
export function damageOverlays(id: number, size: number, frac: number): DamageOverlay[] {
  if (!(frac < 0.66)) return [];
  const n = frac >= 0.33 ? 1 : size >= 4 ? 3 : 2;
  // Points spread around the footprint centre: evenly spaced angles from a hashed start, hashed radius and height.
  const turn = hash01(id, 0) * Math.PI * 2;
  const at = (k: number): { u: number; v: number; lift: number } => {
    const a = turn + (k / n) * Math.PI * 2;
    const r = n === 1 ? 0.12 + 0.18 * hash01(id, k * 3 + 1) : 0.22 + 0.1 * hash01(id, k * 3 + 1);
    return { u: 0.5 + Math.cos(a) * r, v: 0.5 + Math.sin(a) * r, lift: 0.3 + 0.35 * hash01(id, k * 3 + 2) };
  };
  if (n === 1) {
    const p = at(0);
    return [
      { kind: 'smoke', ...p, lift: p.lift + 0.1 },
      { kind: 'fireSmall', ...p },
    ];
  }
  const out: DamageOverlay[] = [];
  const first = at(0);
  out.push({ kind: 'smoke', ...first, lift: first.lift + 0.15 });
  for (let k = 0; k < n; k++) out.push({ kind: 'fireLarge', ...at(k) });
  return out;
}

/** Fire count of `damageOverlays` without allocating (stats). */
export function fireCount(size: number, frac: number): number {
  if (!(frac < 0.66)) return 0;
  return frac >= 0.33 ? 1 : size >= 4 ? 3 : 2;
}

/** Something on the ground for a while: born at `tick`, gone after `life` ticks, fading over the last `fade`. */
export interface Decal {
  readonly tick: number;
  readonly life: number;
  readonly fade: number;
}

/** Opacity of a decal at game time `t` (ticks, fractional): 1, then a linear fade to 0 over its last `fade` ticks. */
export function decalAlpha(d: Decal, t: number): number {
  const age = t - d.tick;
  if (age < 0) return 1;
  if (age >= d.life) return 0;
  const left = d.life - age;
  return left >= d.fade ? 1 : Math.max(0, left / d.fade);
}

/**
 * Decals with a cap: adding beyond `max` drops the oldest (lowest birth tick, then the earliest added); `prune` drops
 * the expired. Insertion order is kept, which is birth order whenever decals are added as events arrive.
 */
export class DecalStore<T extends Decal> {
  private list: T[] = [];
  /** Decals dropped by the cap or expiry since the last `drain` (the layer frees their sprites). */
  private dropped: T[] = [];

  constructor(readonly max: number) {}

  get size(): number {
    return this.list.length;
  }

  items(): readonly T[] {
    return this.list;
  }

  add(d: T): void {
    this.list.push(d);
    if (this.list.length > this.max) {
      // The oldest: lowest birth tick; among equals the first added.
      let oldest = 0;
      for (let i = 1; i < this.list.length; i++) if (this.list[i]!.tick < this.list[oldest]!.tick) oldest = i;
      this.dropped.push(...this.list.splice(oldest, 1));
    }
  }

  /** Drop decals that have expired at game time `t` (ticks). */
  prune(t: number): void {
    let w = 0;
    for (let i = 0; i < this.list.length; i++) {
      const d = this.list[i]!;
      if (t - d.tick >= d.life) this.dropped.push(d);
      else this.list[w++] = d;
    }
    this.list.length = w;
  }

  /** Decals removed since the last call. */
  drain(): T[] {
    const out = this.dropped;
    this.dropped = [];
    return out;
  }

  clear(): void {
    this.dropped.push(...this.list);
    this.list = [];
  }
}
