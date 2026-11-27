/** Pure helpers behind the world overlays (no Pixi), unit tested. */

import type { DataRegistry } from '../../../data/schema';
import type { CommandInput, EntityId, ReadonlyEntity, ResourceType } from '../../../sim/types';
import { footprintOf } from '../entities';

/** Progress bar content for a building, or null when no bar is shown. */
export interface BarSpec {
  kind: 'construction' | 'production';
  /** Fraction in [0, 1]. */
  fraction: number;
}

/**
 * Bar for an own building: construction progress while unfinished, else the
 * front queue item's progress (training or research). Bars are only for the
 * local player's buildings.
 */
export function barFor(e: ReadonlyEntity, owner: number): BarSpec | null {
  if (e.kind !== 'building' || e.owner !== owner) return null;
  if (!e.constructed) return { kind: 'construction', fraction: clamp01(e.progress) };
  const front = e.queue[0];
  if (front === undefined) return null;
  return { kind: 'production', fraction: clamp01(front.ticksTotal > 0 ? front.ticksDone / front.ticksTotal : 0) };
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Colour of the carried-resource marker. */
export const RESOURCE_COLOR: Readonly<Record<ResourceType, number>> = {
  food: 0xe5546b,
  wood: 0xb5783a,
  gold: 0xffd23f,
  stone: 0xb9bcc4,
};

// ---------------------------------------------------------------------------
// Order markers
// ---------------------------------------------------------------------------

export type MarkerKind = 'move' | 'gather' | 'build' | 'attack' | 'attackMove' | 'repair';

export interface MarkerSpec {
  kind: MarkerKind;
  /** World tiles. */
  x: number;
  y: number;
}

export const MARKER_COLOR: Readonly<Record<MarkerKind, number>> = {
  move: 0x62ff7a,
  gather: 0xffe27a,
  build: 0xffa24a,
  attack: 0xff4a3a,
  attackMove: 0xff8a3a,
  repair: 0x5cc8ff,
};
export const MARKER_LIFE_MS = 750;
export const MAX_MARKERS = 8;

/** Where a freshly issued command should show a marker, or null for commands without one. */
export function markerForCommand(
  cmd: CommandInput,
  lookup: (id: EntityId) => ReadonlyEntity | undefined,
  registry: DataRegistry,
): MarkerSpec | null {
  switch (cmd.type) {
    case 'move':
      return { kind: 'move', x: cmd.x, y: cmd.y };
    case 'gather': {
      const t = lookup(cmd.nodeId);
      if (t === undefined || t.kind === 'unit') return null;
      const s = footprintOf(registry, t);
      return { kind: 'gather', x: t.tile.tx + s / 2, y: t.tile.ty + s / 2 };
    }
    case 'assist': {
      const t = lookup(cmd.buildingId);
      if (t === undefined || t.kind !== 'building') return null;
      const s = footprintOf(registry, t);
      return { kind: 'build', x: t.tile.tx + s / 2, y: t.tile.ty + s / 2 };
    }
    case 'attackMove':
      return { kind: 'attackMove', x: cmd.x, y: cmd.y };
    case 'attack': {
      const t = lookup(cmd.targetId);
      if (t === undefined || t.kind === 'node') return null;
      if (t.kind === 'unit') return { kind: 'attack', x: t.pos.x, y: t.pos.y };
      const s = footprintOf(registry, t);
      return { kind: 'attack', x: t.tile.tx + s / 2, y: t.tile.ty + s / 2 };
    }
    case 'repair': {
      const t = lookup(cmd.buildingId);
      if (t === undefined || t.kind !== 'building') return null;
      const s = footprintOf(registry, t);
      return { kind: 'repair', x: t.tile.tx + s / 2, y: t.tile.ty + s / 2 };
    }
    case 'build': {
      const d = registry.def(cmd.buildingType);
      const s = d !== undefined && d.kind === 'building' ? d.footprint : 1;
      return { kind: 'build', x: cmd.tx + s / 2, y: cmd.ty + s / 2 };
    }
    default:
      return null;
  }
}

/** Fixed-size ring of active markers; adding never allocates. */
export class MarkerRing {
  readonly kind: MarkerKind[] = new Array<MarkerKind>(MAX_MARKERS).fill('move');
  readonly x = new Array<number>(MAX_MARKERS).fill(0);
  readonly y = new Array<number>(MAX_MARKERS).fill(0);
  readonly born = new Array<number>(MAX_MARKERS).fill(-Infinity);
  private next = 0;

  add(spec: MarkerSpec, nowMs: number): void {
    const i = this.next;
    this.next = (this.next + 1) % MAX_MARKERS;
    this.kind[i] = spec.kind;
    this.x[i] = spec.x;
    this.y[i] = spec.y;
    this.born[i] = nowMs;
  }

  /** Age in [0, 1) of slot `i`, or -1 when it is expired or empty. */
  age(i: number, nowMs: number): number {
    const a = (nowMs - this.born[i]!) / MARKER_LIFE_MS;
    return a >= 0 && a < 1 ? a : -1;
  }
}

/** Marker look at age `a` in [0, 1): it shrinks onto the target while fading out. */
export function markerLook(a: number): { scale: number; alpha: number } {
  return { scale: 1.25 - 0.6 * a, alpha: 1 - a * a };
}

/**
 * World-pixel y (iso screen space at 1x) of the centre of a building's progress bar. It sits `gap` above the top of
 * the art when that is known, else at an estimate from the footprint. Both are world pixels, so the bar moves with the
 * building at every zoom; only `gap` (half the bar plus a little air) is scaled by the caller to stay a fixed number of
 * screen pixels.
 */
export function barCentreY(anchorY: number, top: number | null, size: number, constructed: boolean, gap: number): number {
  if (top !== null) return top - gap;
  const rise = constructed ? 28 * size + 24 : 14 * size + 12;
  return anchorY - rise;
}

// ---------------------------------------------------------------------------
// Health bars (PLAN-M2 7.2)
// ---------------------------------------------------------------------------

/** Fill colours of an own entity's health bar. */
export const HP_GREEN = 0x4fd05a;
export const HP_YELLOW = 0xe8c53a;
export const HP_RED = 0xe0453a;
/** Frame and empty part of every health bar. */
export const HP_FRAME = 0x0c0e08;

/** Unit bars are 30 x 4 screen px, 6 px above the top of the art. */
export const HP_UNIT_W = 30;
export const HP_UNIT_H = 4;
export const HP_UNIT_GAP = 6;
/** Building bars are `16 * footprint + 16` x 5 screen px, 3 px above the top of the art. */
export const HP_BUILDING_H = 5;
export const HP_BUILDING_GAP = 3;

/** Compact unit bars (crowds, zoomed out): 18 x 2 screen px, so neighbouring bars in a packed army stay apart. */
export const HP_UNIT_COMPACT_W = 18;
export const HP_UNIT_COMPACT_H = 2;
/** More selected units than this: selection alone no longer shows a bar, only damage does (the rings show the selection). */
export const HP_CROWD_SELECTION = 12;
/** More unit bars than this on screen, or a zoom below HP_COMPACT_ZOOM: unit bars are compact. */
export const HP_CROWD_BARS = 24;
export const HP_COMPACT_ZOOM = 0.75;

const UNIT_BAR_SIZE: Readonly<{ w: number; h: number }> = { w: HP_UNIT_W, h: HP_UNIT_H };
const UNIT_BAR_COMPACT: Readonly<{ w: number; h: number }> = { w: HP_UNIT_COMPACT_W, h: HP_UNIT_COMPACT_H };
const buildingBarSizes: { w: number; h: number }[] = [];

/**
 * Screen-pixel width and height of a health bar (the frame adds 1 px all round). `compact` unit bars for crowds and
 * zoomed-out views. Shared objects: never mutate.
 */
export function healthBarSize(kind: 'unit' | 'building', footprint: number, compact = false): Readonly<{ w: number; h: number }> {
  if (kind === 'unit') return compact ? UNIT_BAR_COMPACT : UNIT_BAR_SIZE;
  return (buildingBarSizes[footprint] ??= { w: 16 * footprint + 16, h: HP_BUILDING_H });
}

/** Does selection alone show a unit's bar? Not once more than HP_CROWD_SELECTION units are selected. */
export function selectionShowsBar(selectedUnits: number): boolean {
  return selectedUnits <= HP_CROWD_SELECTION;
}

/** Compact unit bars: zoomed out, or more than HP_CROWD_BARS unit bars to draw. */
export function compactUnitBars(zoom: number, unitBars: number): boolean {
  return zoom < HP_COMPACT_ZOOM || unitBars > HP_CROWD_BARS;
}

/**
 * Whether an entity shows a health bar: selected (any owner) or damaged. Dead or unknown-max entities never do.
 * `intactHp` is what the entity would have undamaged: for a foundation the hp its construction has granted so far
 * (`builtHp`), so a building going up does not show a bar (its low construction hp is not damage) until it is hit.
 */
export function healthBarShown(hp: number, maxHp: number, selected: boolean, intactHp = maxHp): boolean {
  return maxHp > 0 && hp > 0 && (selected || hp < Math.min(maxHp, intactHp));
}

/** Own entities: green at 50% and above, yellow from 25% up to 50%, red below 25%. Enemy entities are always red. */
export function healthBarColor(hp: number, maxHp: number, own: boolean): number {
  if (!own) return HP_RED;
  const f = maxHp > 0 ? hp / maxHp : 0;
  return f >= 0.5 ? HP_GREEN : f >= 0.25 ? HP_YELLOW : HP_RED;
}

/** Filled width in screen px: whole pixels, at least 1 while alive. */
export function healthBarFill(hp: number, maxHp: number, width: number): number {
  if (maxHp <= 0 || hp <= 0) return 0;
  return Math.min(width, Math.max(1, Math.round((width * hp) / maxHp)));
}

/**
 * Max hp per (owner, def) as resolved for the player, cached so the per-frame loop does no allocation. The caller
 * clears a player's entries when its researched list changes (techs raise hp).
 */
export class MaxHpCache {
  private readonly byOwner: Map<string, number>[] = [];
  private readonly sizes: number[] = [];

  constructor(private readonly resolve: (owner: number, typeId: string) => number) {}

  get(owner: number, typeId: string, researchedCount: number): number {
    let m = this.byOwner[owner];
    if (m === undefined) {
      m = new Map();
      this.byOwner[owner] = m;
      this.sizes[owner] = researchedCount;
    } else if (this.sizes[owner] !== researchedCount) {
      m.clear();
      this.sizes[owner] = researchedCount;
    }
    let v = m.get(typeId);
    if (v === undefined) {
      v = this.resolve(owner, typeId);
      m.set(typeId, v);
    }
    return v;
  }
}

/** Screen-pixel half height of a construction or production bar, and the air around it. */
const PROGRESS_H = 5;

/**
 * World-pixel y of the centres of a building's health bar (null when it has none) and progress bar. The health bar
 * sits `HP_BUILDING_GAP` screen px above the art top; the progress bar moves above it when both show, else it takes
 * the health bar's place (4 px above the art, as in M1). `inv` is 1 / zoom, so gaps stay constant on screen.
 */
export function buildingBarCentres(
  anchorY: number,
  top: number | null,
  footprint: number,
  constructed: boolean,
  inv: number,
  showHealth: boolean,
): { health: number | null; progress: number } {
  if (!showHealth) return { health: null, progress: barCentreY(anchorY, top, footprint, constructed, (PROGRESS_H / 2 + 4) * inv) };
  const h = HP_BUILDING_H / 2;
  const health = barCentreY(anchorY, top, footprint, constructed, (h + HP_BUILDING_GAP) * inv);
  return { health, progress: health - (h + PROGRESS_H / 2 + 3) * inv };
}
