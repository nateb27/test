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

export type MarkerKind = 'move' | 'gather' | 'build';

export interface MarkerSpec {
  kind: MarkerKind;
  /** World tiles. */
  x: number;
  y: number;
}

export const MARKER_COLOR: Readonly<Record<MarkerKind, number>> = { move: 0x62ff7a, gather: 0xffe27a, build: 0xffa24a };
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
