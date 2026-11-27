/**
 * Canvas cursors of the combat modes (PLAN-M2 7.1), drawn in code as data-URI SVGs:
 * a sword over an enemy the selection can attack, a crosshair in attack-move mode and a hammer in repair mode.
 */

import type { DataRegistry } from '../../../data/schema';
import type { EntityId, PlayerId, ReadonlyEntity } from '../../../sim/types';
import { anySelectedCanTarget } from './targeting';

export type CursorKind = 'default' | 'attack' | 'attackMove' | 'repair';

/** Which cursor applies: target modes win, else the sword over an attackable enemy, else the default. */
export function resolveCursor(
  mode: 'attackMove' | 'repair' | 'other' | null,
  hover: ReadonlyEntity | null,
  selected: readonly ReadonlyEntity[],
  owner: PlayerId,
  registry: DataRegistry,
): CursorKind {
  if (mode === 'attackMove') return 'attackMove';
  if (mode === 'repair') return 'repair';
  if (mode === null && hover !== null && anySelectedCanTarget(selected, hover, owner, registry)) return 'attack';
  return 'default';
}

const STROKE = '#0c0e08';

const SVG: Readonly<Record<Exclude<CursorKind, 'default'>, { body: string; hx: number; hy: number }>> = {
  // Sword pointing up-left: the hot spot is the tip.
  attack: {
    hx: 3,
    hy: 3,
    body:
      `<path d="M3 3 L7 3 L19 15 L17 17 L5 5 Z" fill="#e8ecf2" stroke="${STROKE}" stroke-width="1.4" stroke-linejoin="round"/>` +
      `<path d="M15 13 L21 19 L19 21 L13 15 Z" fill="#d6a24a" stroke="${STROKE}" stroke-width="1.4" stroke-linejoin="round"/>` +
      `<path d="M19 19 L25 25 L23 27 L17 21 Z" fill="#8a5a2a" stroke="${STROKE}" stroke-width="1.4" stroke-linejoin="round"/>`,
  },
  // Crosshair: ring, four ticks, hot spot at the centre.
  attackMove: {
    hx: 16,
    hy: 16,
    body:
      `<circle cx="16" cy="16" r="8" fill="none" stroke="${STROKE}" stroke-width="4.5"/>` +
      `<path d="M16 2 V10 M16 22 V30 M2 16 H10 M22 16 H30" stroke="${STROKE}" stroke-width="4.5" stroke-linecap="round"/>` +
      `<circle cx="16" cy="16" r="8" fill="none" stroke="#ff5a4a" stroke-width="2"/>` +
      `<path d="M16 2 V10 M16 22 V30 M2 16 H10 M22 16 H30" stroke="#ff5a4a" stroke-width="2" stroke-linecap="round"/>`,
  },
  // Hammer: head up-left, handle down-right; hot spot at the head.
  repair: {
    hx: 6,
    hy: 6,
    body:
      `<path d="M12 12 L27 27" stroke="${STROKE}" stroke-width="6" stroke-linecap="round"/>` +
      `<path d="M12 12 L27 27" stroke="#c98a4a" stroke-width="3.2" stroke-linecap="round"/>` +
      `<path d="M3 9 L9 3 L17 11 L11 17 Z" fill="#cfd4dc" stroke="${STROKE}" stroke-width="1.6" stroke-linejoin="round"/>`,
  },
};

/** CSS `cursor` value for a kind (`''` leaves the page's own cursor). */
export function cursorCss(kind: CursorKind): string {
  if (kind === 'default') return '';
  const c = SVG[kind];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">${c.body}</svg>`;
  const fallback = kind === 'attackMove' ? 'crosshair' : kind === 'repair' ? 'cell' : 'pointer';
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${c.hx} ${c.hy}, ${fallback}`;
}

export interface CursorDeps {
  canvas: HTMLCanvasElement;
  pickEntity(cx: number, cy: number): EntityId | null;
  entityById(id: EntityId): ReadonlyEntity | undefined;
  selection(): readonly EntityId[];
  playerId: PlayerId;
  registry: DataRegistry;
  /** The active mode's kind, or null when none. */
  modeKind(): string | null;
  /** Subscribe to selection changes (so a sword appears or goes while the pointer rests). */
  onSelection?(listener: () => void): () => void;
}

export interface CursorController {
  /** The cursor the canvas currently shows. */
  current(): CursorKind;
  /** Recompute from the last pointer position (call after mode or selection changes). */
  refresh(): void;
  destroy(): void;
}

export function createCursorController(deps: CursorDeps): CursorController {
  let kind: CursorKind = 'default';
  let pointer: { x: number; y: number } | null = null;
  const css = new Map<CursorKind, string>();

  const compute = (): CursorKind => {
    const m = deps.modeKind();
    const mode = m === null ? null : m === 'attackMove' || m === 'repair' ? m : 'other';
    let hover: ReadonlyEntity | null = null;
    if (mode === null && pointer !== null) {
      const id = deps.pickEntity(pointer.x, pointer.y);
      hover = id === null ? null : (deps.entityById(id) ?? null);
    }
    const selected: ReadonlyEntity[] = [];
    if (hover !== null) {
      for (const id of deps.selection()) {
        const e = deps.entityById(id);
        if (e !== undefined) selected.push(e);
      }
    }
    return resolveCursor(mode, hover, selected, deps.playerId, deps.registry);
  };

  const apply = (next: CursorKind): void => {
    if (next === kind) return;
    kind = next;
    let v = css.get(next);
    if (v === undefined) {
      v = cursorCss(next);
      css.set(next, v);
    }
    deps.canvas.style.cursor = v;
    // Mirrored for DOM inspection; `cursor()` (and so the debug hook) reads `kind`, the one source of truth.
    if (next === 'default') delete deps.canvas.dataset.cursor;
    else deps.canvas.dataset.cursor = next;
  };

  const refresh = (): void => apply(compute());
  const onMove = (e: MouseEvent): void => {
    const r = deps.canvas.getBoundingClientRect();
    pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
    refresh();
  };
  const onLeave = (): void => {
    pointer = null;
    refresh();
  };
  deps.canvas.addEventListener('mousemove', onMove);
  deps.canvas.addEventListener('mouseleave', onLeave);
  const offSelection = deps.onSelection?.(refresh);

  return {
    current: () => kind,
    refresh,
    destroy() {
      deps.canvas.removeEventListener('mousemove', onMove);
      deps.canvas.removeEventListener('mouseleave', onLeave);
      offSelection?.();
      deps.canvas.style.cursor = '';
      delete deps.canvas.dataset.cursor;
    },
  };
}
