/**
 * Minimap (plan 7.3): canvas-2D rotated-diamond view of the whole map.
 *
 * Three canvases in one wrapper:
 * - cached terrain (drawn once per size),
 * - cached nodes and buildings (redrawn only when they change),
 * - the visible one, composed at 5 Hz from the caches plus units,
 * - plus a thin top canvas with the camera outline, redrawn only when the
 *   camera moved, so panning never waits for the 5 Hz tick.
 *
 * Left click and drag move the camera; right click issues the contextual order.
 */

import type { DataRegistry } from '../../../data/schema';
import type { PlayerId, ReadonlyGameState, Vec2 } from '../../../sim/types';
import { perf } from '../../debug/perf';
import { footprintOf } from '../../render/entities';
import {
  cameraOutline,
  clampToMap,
  createMinimapView,
  minimapToWorld,
  worldToMinimap,
  type MinimapView,
} from './geometry';
import { PING_COLOR, pingLook, PingSet } from './pings';

export interface MinimapDeps {
  /** Element to mount into (the HUD's `#minimap-slot`). The minimap fills it. */
  container: HTMLElement;
  /** Live sim state. */
  getState(): ReadonlyGameState;
  registry: DataRegistry;
  playerId: PlayerId;
  renderer: {
    jumpTo(x: number, y: number): void;
    visibleWorldCorners(): [Vec2, Vec2, Vec2, Vec2];
    worldToCanvas(x: number, y: number): { x: number; y: number };
  };
  input: { issueContextOrder(p: { x: number; y: number }, shift: boolean): unknown };
}

export interface Minimap {
  readonly element: HTMLElement;
  readonly view: MinimapView;
  /** Redraw everything now (the 5 Hz timer calls the units part). */
  redraw(): void;
  /**
   * Red expanding ring at a world position, timed on the match clock (`state.tick`): 1.5 s, twice, at most 4 live.
   * The app calls it from the HUD's alert handler (`HudControllerOptions.onAlert`), once per own `UnderAttack`.
   */
  ping(x: number, y: number, color?: number): void;
  /** Live pings (what the debug hook `alerts()` reports). */
  alerts(): { x: number; y: number; tick: number }[];
  /** World tiles -> page CSS pixels of the minimap (for tests and tools). */
  worldToPage(x: number, y: number): Vec2;
  destroy(): void;
}

/** Redraw period of the dynamic layer. */
export const MINIMAP_REFRESH_MS = 200;
const DEFAULT_W = 240;
const DEFAULT_H = 120;

function css(n: number): string {
  return `#${(n & 0xffffff).toString(16).padStart(6, '0')}`;
}

function makeCanvas(w: number, h: number, dpr: number): { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  const g = canvas.getContext('2d');
  if (g === null) throw new Error('2d canvas unavailable');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { canvas, g };
}

/** A pixel-aligned square mark of `size` px centred near (cx, cy) with a 1 px dark rim, so it stays crisp. */
function mark(g: CanvasRenderingContext2D, cx: number, cy: number, size: number, fill: string): void {
  const x = Math.round(cx - size / 2);
  const y = Math.round(cy - size / 2);
  g.fillStyle = 'rgba(8,10,6,0.9)';
  g.fillRect(x - 1, y - 1, size + 2, size + 2);
  g.fillStyle = fill;
  g.fillRect(x, y, size, size);
}

function diamondPath(g: CanvasRenderingContext2D, v: MinimapView, x0: number, y0: number, x1: number, y1: number): void {
  const a = worldToMinimap(v, x0, y0);
  const b = worldToMinimap(v, x1, y0);
  const c = worldToMinimap(v, x1, y1);
  const d = worldToMinimap(v, x0, y1);
  g.beginPath();
  g.moveTo(a.x, a.y);
  g.lineTo(b.x, b.y);
  g.lineTo(c.x, c.y);
  g.lineTo(d.x, d.y);
  g.closePath();
}

export function mountMinimap(deps: MinimapDeps): Minimap {
  const { container, registry } = deps;
  const wrap = document.createElement('div');
  wrap.className = 'minimap';
  wrap.dataset.testid = 'minimap';
  wrap.style.cssText = 'position:relative;width:100%;height:100%;min-width:120px;min-height:60px;touch-action:none;user-select:none;';
  container.appendChild(wrap);

  let dpr = window.devicePixelRatio || 1;
  let view = createMinimapView(deps.getState().map.width, deps.getState().map.height, DEFAULT_W, DEFAULT_H);
  let terrain = makeCanvas(1, 1, 1);
  let statics = makeCanvas(1, 1, 1);
  let main = makeCanvas(1, 1, 1);
  let fx = makeCanvas(1, 1, 1);
  let top = makeCanvas(1, 1, 1);
  const pings = new PingSet();
  let pingKey = -1;
  let pingsDrawn = false;
  let staticKey = '';
  let lastOutline = '';
  let timer: number | null = null;
  let raf: number | null = null;
  let dragging = false;
  let destroyed = false;

  const place = (c: HTMLCanvasElement): void => {
    c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
  };

  const layout = (): void => {
    const w = wrap.clientWidth > 0 ? wrap.clientWidth : DEFAULT_W;
    const h = wrap.clientHeight > 0 ? wrap.clientHeight : DEFAULT_H;
    dpr = window.devicePixelRatio || 1;
    const map = deps.getState().map;
    view = createMinimapView(map.width, map.height, w, h);
    for (const c of [main, fx, top]) c.canvas.remove();
    terrain = makeCanvas(w, h, dpr);
    statics = makeCanvas(w, h, dpr);
    main = makeCanvas(w, h, dpr);
    fx = makeCanvas(w, h, dpr);
    top = makeCanvas(w, h, dpr);
    place(main.canvas);
    place(fx.canvas);
    fx.canvas.style.pointerEvents = 'none';
    fx.canvas.dataset.testid = 'minimap-pings';
    place(top.canvas);
    top.canvas.dataset.testid = 'minimap-canvas';
    main.canvas.dataset.testid = 'minimap-base';
    wrap.append(main.canvas, fx.canvas, top.canvas);
    attach(top.canvas);
    drawTerrain();
    staticKey = '';
    lastOutline = '';
    pingKey = -1;
  };

  // ------------------------------------------------------------- drawing

  const drawTerrain = (): void => {
    const g = terrain.g;
    const { map } = deps.getState();
    g.clearRect(0, 0, view.width, view.height);
    const base = map.tiles[0];
    const baseDef = base === undefined ? undefined : registry.terrains.find((t) => t.id === base);
    diamondPath(g, view, 0, 0, map.width, map.height);
    g.fillStyle = css(baseDef?.minimapColor ?? 0x4f7a32);
    g.fill();
    for (let ty = 0; ty < map.height; ty++) {
      for (let tx = 0; tx < map.width; tx++) {
        const id = map.tiles[ty * map.width + tx];
        if (id === base || id === undefined) continue;
        const def = registry.terrains.find((t) => t.id === id);
        if (def === undefined) continue;
        diamondPath(g, view, tx, ty, tx + 1, ty + 1);
        g.fillStyle = css(def.minimapColor);
        g.fill();
      }
    }
  };

  /** Cheap change signature of nodes and buildings (ids and construction state). */
  const staticSignature = (state: ReadonlyGameState): string => {
    let h = 17;
    let n = 0;
    for (const e of state.entities) {
      if (e.kind === 'unit') continue;
      n++;
      h = (Math.imul(h, 31) + e.id * 2 + (e.kind === 'building' && e.constructed ? 1 : 0)) | 0;
    }
    return `${n}:${h}:${view.width}x${view.height}`;
  };

  const drawStatics = (state: ReadonlyGameState): void => {
    const g = statics.g;
    g.clearRect(0, 0, view.width, view.height);
    g.drawImage(terrain.canvas, 0, 0, view.width, view.height);
    // Nodes first (below buildings).
    for (const e of state.entities) {
      if (e.kind !== 'node') continue;
      const def = registry.def(e.typeId);
      if (def === undefined || def.kind !== 'node') continue;
      const size = def.footprint;
      const c = worldToMinimap(view, e.tile.tx + size / 2, e.tile.ty + size / 2);
      g.fillStyle = css(def.minimapColor);
      if (def.resource === 'wood') {
        // Exact footprint when it is big enough to see, else a crisp pixel (at the HUD's size a tile is under 1 px).
        if (view.k * size >= 2) {
          diamondPath(g, view, e.tile.tx, e.tile.ty, e.tile.tx + size, e.tile.ty + size);
          g.fill();
        } else {
          g.fillRect(Math.round(c.x - 0.5), Math.round(c.y - 0.5), 1, 1);
        }
      } else {
        // Ore and food stand out: a pixel-aligned square of at least 3 px with a dark rim.
        mark(g, c.x, c.y, Math.max(3, Math.round(size * view.k * 1.2)), css(def.minimapColor));
      }
    }
    for (const e of state.entities) {
      if (e.kind !== 'building') continue;
      const size = footprintOf(registry, e);
      const color = state.players[e.owner]?.color ?? 0xffffff;
      diamondPath(g, view, e.tile.tx, e.tile.ty, e.tile.tx + size, e.tile.ty + size);
      g.globalAlpha = e.constructed ? 1 : 0.55;
      g.fillStyle = css(color);
      g.fill();
      g.globalAlpha = 1;
      g.lineWidth = 1.25;
      g.strokeStyle = 'rgba(8,10,6,0.9)';
      g.stroke();
    }
  };

  const drawMain = (): void => {
    const t0 = perf.start();
    const state = deps.getState();
    const key = staticSignature(state);
    if (key !== staticKey) {
      staticKey = key;
      const t1 = perf.start();
      drawStatics(state);
      perf.end('minimap.statics', t1);
    }
    const g = main.g;
    g.clearRect(0, 0, view.width, view.height);
    g.drawImage(statics.canvas, 0, 0, view.width, view.height);
    for (const e of state.entities) {
      if (e.kind !== 'unit') continue;
      const p = worldToMinimap(view, e.pos.x, e.pos.y);
      mark(g, p.x, p.y, 3, css(state.players[e.owner]?.color ?? 0xffffff));
    }
    // Frame: the diamond border.
    diamondPath(g, view, 0, 0, view.mapW, view.mapH);
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(8,10,6,0.9)';
    g.stroke();
    perf.end('minimap.main', t0);
  };

  const drawOutline = (force: boolean): void => {
    const t0 = perf.start();
    const pts = cameraOutline(view, deps.renderer.visibleWorldCorners());
    const key = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(';');
    if (!force && key === lastOutline) {
      perf.end('minimap.outlineCheck', t0);
      return;
    }
    lastOutline = key;
    const g = top.g;
    g.clearRect(0, 0, view.width, view.height);
    g.save();
    diamondPath(g, view, 0, 0, view.mapW, view.mapH);
    g.clip();
    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < 4; i++) g.lineTo(pts[i]!.x, pts[i]!.y);
    g.closePath();
    g.lineJoin = 'round';
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(8,10,6,0.75)';
    g.stroke();
    g.lineWidth = 1.5;
    g.strokeStyle = '#ffffff';
    g.stroke();
    g.restore();
    perf.end('minimap.outline', t0);
  };

  /** Rings on their own canvas, redrawn only when the match clock or the ping set changed (never while paused). */
  const drawPings = (): void => {
    const tick = deps.getState().tick;
    pings.prune(tick);
    const n = pings.size;
    if (n === 0) {
      if (pingsDrawn) {
        fx.g.clearRect(0, 0, view.width, view.height);
        pingsDrawn = false;
      }
      pingKey = -1;
      return;
    }
    const key = tick * 8 + n;
    if (key === pingKey) return;
    pingKey = key;
    const g = fx.g;
    g.clearRect(0, 0, view.width, view.height);
    for (let i = 0; i < n; i++) {
      const p = pings.at(i);
      const look = pingLook(tick - p.tick);
      const c = worldToMinimap(view, p.x, p.y);
      const radius = 2 + look.t * 13;
      g.globalAlpha = look.alpha;
      g.lineWidth = 3.5;
      g.strokeStyle = 'rgba(8,10,6,0.85)';
      g.beginPath();
      g.arc(c.x, c.y, radius, 0, Math.PI * 2);
      g.stroke();
      g.lineWidth = 1.75;
      g.strokeStyle = css(p.color);
      g.stroke();
    }
    g.globalAlpha = 1;
    pingsDrawn = true;
  };

  const redraw = (): void => {
    drawMain();
    drawOutline(true);
    drawPings();
  };

  // --------------------------------------------------------- interaction

  const local = (e: PointerEvent): Vec2 => {
    const r = top.canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * view.width) / Math.max(1, r.width), y: ((e.clientY - r.top) * view.height) / Math.max(1, r.height) };
  };
  const worldAt = (e: PointerEvent): Vec2 => {
    const p = local(e);
    return clampToMap(view, minimapToWorld(view, p.x, p.y));
  };

  const listeners: (() => void)[] = [];
  function attach(el: HTMLCanvasElement): void {
    for (const off of listeners.splice(0)) off();
    const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void): void => {
      el.addEventListener(type, fn as EventListener);
      listeners.push(() => el.removeEventListener(type, fn as EventListener));
    };
    on('contextmenu', (e) => e.preventDefault());
    on('pointerdown', (e) => {
      e.preventDefault();
      const w = worldAt(e);
      if (e.button === 0) {
        dragging = true;
        el.setPointerCapture(e.pointerId);
        deps.renderer.jumpTo(w.x, w.y);
        drawOutline(false);
      } else if (e.button === 2) {
        const c = deps.renderer.worldToCanvas(w.x, w.y);
        deps.input.issueContextOrder(c, e.shiftKey);
      }
    });
    on('pointermove', (e) => {
      if (!dragging) return;
      const w = worldAt(e);
      deps.renderer.jumpTo(w.x, w.y);
      drawOutline(false);
    });
    const stop = (e: PointerEvent): void => {
      if (!dragging) return;
      dragging = false;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };
    on('pointerup', stop);
    on('pointercancel', stop);
  }

  // ------------------------------------------------------------ lifecycle

  layout();
  redraw();
  timer = window.setInterval(drawMain, MINIMAP_REFRESH_MS);
  const loop = (): void => {
    if (destroyed) return;
    drawOutline(false);
    drawPings();
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
    if (destroyed) return;
    if (Math.abs(wrap.clientWidth - view.width) > 0.5 || Math.abs(wrap.clientHeight - view.height) > 0.5) {
      layout();
      redraw();
    }
  });
  ro?.observe(wrap);
  const api: Minimap = {
    element: wrap,
    get view() {
      return view;
    },
    redraw,
    ping(x, y, color = PING_COLOR) {
      if (destroyed) return;
      pings.add(x, y, color, deps.getState().tick);
      drawPings();
    },
    alerts() {
      pings.prune(deps.getState().tick);
      const out: { x: number; y: number; tick: number }[] = [];
      for (let i = 0; i < pings.size; i++) {
        const p = pings.at(i);
        out.push({ x: p.x, y: p.y, tick: p.tick });
      }
      return out;
    },
    worldToPage(x, y) {
      const p = worldToMinimap(view, x, y);
      const r = top.canvas.getBoundingClientRect();
      return { x: r.left + (p.x * r.width) / view.width, y: r.top + (p.y * r.height) / view.height };
    },
    destroy() {
      destroyed = true;
      if (timer !== null) window.clearInterval(timer);
      if (raf !== null) cancelAnimationFrame(raf);
      ro?.disconnect();
      for (const off of listeners.splice(0)) off();
      wrap.remove();
    },
  };
  return api;
}
