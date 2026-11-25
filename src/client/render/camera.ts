/**
 * Camera: pure maths (`Camera`) plus the DOM input binding (`CameraInput`).
 *
 * The camera state is a point in "world pixels" (iso.ts screen space at 1x)
 * that sits at the centre of the viewport, plus a zoom. Everything client-only:
 * never saved or hashed.
 */

import type { Vec2 } from '../../sim/types';
import { screenToWorld, worldToScreen, type ScreenPoint } from './iso';

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 2;

export interface WorldPxRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export class Camera {
  /** World pixel at the viewport centre. */
  x = 0;
  y = 0;
  zoom = 1;
  viewW = 1280;
  viewH = 720;
  /** Allowed area for the viewport (world pixels). */
  private bounds: WorldPxRect = { minX: -1e9, minY: -1e9, maxX: 1e9, maxY: 1e9 };

  setBounds(b: WorldPxRect): void {
    this.bounds = b;
    this.clamp();
  }

  getBounds(): Readonly<WorldPxRect> {
    return this.bounds;
  }

  setViewport(w: number, h: number): void {
    this.viewW = Math.max(1, w);
    this.viewH = Math.max(1, h);
    this.clamp();
  }

  /** Canvas CSS pixels -> world pixels. */
  canvasToWorldPx(cx: number, cy: number): ScreenPoint {
    return { x: (cx - this.viewW / 2) / this.zoom + this.x, y: (cy - this.viewH / 2) / this.zoom + this.y };
  }

  /** World pixels -> canvas CSS pixels. */
  worldPxToCanvas(sx: number, sy: number): ScreenPoint {
    return { x: (sx - this.x) * this.zoom + this.viewW / 2, y: (sy - this.y) * this.zoom + this.viewH / 2 };
  }

  /** World tiles -> canvas CSS pixels. */
  worldToCanvas(x: number, y: number): ScreenPoint {
    const s = worldToScreen(x, y);
    return this.worldPxToCanvas(s.x, s.y);
  }

  /** Canvas CSS pixels -> world tiles. */
  canvasToWorld(cx: number, cy: number): Vec2 {
    const s = this.canvasToWorldPx(cx, cy);
    return screenToWorld(s.x, s.y);
  }

  /** Visible area in world pixels. */
  visibleRect(): WorldPxRect {
    const hw = this.viewW / (2 * this.zoom);
    const hh = this.viewH / (2 * this.zoom);
    return { minX: this.x - hw, minY: this.y - hh, maxX: this.x + hw, maxY: this.y + hh };
  }

  /** Pan by a canvas-pixel delta (positive = content moves right/down, i.e. view moves left/up). */
  panCanvas(dx: number, dy: number): void {
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
    this.clamp();
  }

  /** Move the view by a canvas-pixel delta in the direction of the view (key and edge scrolling). */
  scrollBy(dx: number, dy: number): void {
    this.x += dx / this.zoom;
    this.y += dy / this.zoom;
    this.clamp();
  }

  /** Set zoom to `zoom` (clamped) keeping the world point under canvas pixel (cx, cy) fixed. */
  zoomAt(cx: number, cy: number, zoom: number): void {
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    const before = this.canvasToWorldPx(cx, cy);
    this.zoom = z;
    this.x = before.x - (cx - this.viewW / 2) / z;
    this.y = before.y - (cy - this.viewH / 2) / z;
    this.clamp();
  }

  /** Multiply zoom by `factor`, about a canvas pixel. */
  zoomBy(cx: number, cy: number, factor: number): void {
    this.zoomAt(cx, cy, this.zoom * factor);
  }

  /** Centre the view on a world position (tiles). */
  jumpTo(wx: number, wy: number): void {
    const s = worldToScreen(wx, wy);
    this.x = s.x;
    this.y = s.y;
    this.clamp();
  }

  /** Keep the viewport inside the bounds (centred if the bounds are smaller than the view). */
  clamp(): void {
    const b = this.bounds;
    const hw = this.viewW / (2 * this.zoom);
    const hh = this.viewH / (2 * this.zoom);
    this.x = clampAxis(this.x, b.minX, b.maxX, hw);
    this.y = clampAxis(this.y, b.minY, b.maxY, hh);
  }
}

function clampAxis(v: number, min: number, max: number, half: number): number {
  if (max - min <= half * 2) return (min + max) / 2;
  return Math.min(max - half, Math.max(min + half, v));
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface CameraInputOptions {
  /** Pan speed in canvas pixels per second. */
  keySpeed?: number;
  edgeSpeed?: number;
  /** Width in pixels of the screen-edge scroll zone. */
  edgeZone?: number;
  edgeScroll?: boolean;
  /** Include WASD (arrows always pan). WASD collides with the command-card grid; WP5/9 may turn it off. */
  wasd?: boolean;
}

const PAN_KEYS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};
const WASD_KEYS: Readonly<Record<string, readonly [number, number]>> = {
  a: [-1, 0],
  d: [1, 0],
  w: [0, -1],
  s: [0, 1],
};

export class CameraInput {
  private readonly keys = new Set<string>();
  private mouse: { x: number; y: number } | null = null;
  private drag: { x: number; y: number } | null = null;
  private enabled = true;
  private readonly cleanup: (() => void)[] = [];
  readonly opts: Required<CameraInputOptions>;

  constructor(
    private readonly camera: Camera,
    canvas: HTMLCanvasElement,
    options: CameraInputOptions = {},
  ) {
    this.opts = { keySpeed: 900, edgeSpeed: 700, edgeZone: 6, edgeScroll: true, wasd: true, ...options };
    const on = <K extends keyof WindowEventMap>(t: Window, type: K, fn: (e: WindowEventMap[K]) => void): void => {
      t.addEventListener(type, fn as EventListener);
      this.cleanup.push(() => t.removeEventListener(type, fn as EventListener));
    };
    const onCanvas = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, passive = true): void => {
      canvas.addEventListener(type, fn as EventListener, { passive });
      this.cleanup.push(() => canvas.removeEventListener(type, fn as EventListener));
    };

    on(window, 'keydown', (e) => {
      if (!this.enabled || isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (this.isPanKey(e.key)) {
        this.keys.add(this.normalize(e.key));
        if (e.key.startsWith('Arrow')) e.preventDefault();
      }
    });
    on(window, 'keyup', (e) => {
      this.keys.delete(this.normalize(e.key));
    });
    on(window, 'blur', () => {
      this.keys.clear();
      this.drag = null;
    });
    onCanvas('wheel', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      this.camera.zoomBy(e.clientX - r.left, e.clientY - r.top, Math.exp(-delta * 0.0012));
    }, false);
    onCanvas('mousedown', (e) => {
      if (e.button === 1 && this.enabled) {
        e.preventDefault();
        this.drag = { x: e.clientX, y: e.clientY };
      }
    }, false);
    on(window, 'mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouse = { x: e.clientX - r.left, y: e.clientY - r.top };
      if (this.drag !== null) {
        this.camera.panCanvas(e.clientX - this.drag.x, e.clientY - this.drag.y);
        this.drag = { x: e.clientX, y: e.clientY };
      }
    });
    on(window, 'mouseup', (e) => {
      if (e.button === 1) this.drag = null;
    });
    onCanvas('mouseleave', () => {
      this.mouse = null;
    });
  }

  private normalize(key: string): string {
    return key.length === 1 ? key.toLowerCase() : key;
  }

  private isPanKey(key: string): boolean {
    const k = this.normalize(key);
    return k in PAN_KEYS || (this.opts.wasd && k in WASD_KEYS);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) {
      this.keys.clear();
      this.drag = null;
    }
  }

  setWasd(on: boolean): void {
    this.opts.wasd = on;
    if (!on) for (const k of Object.keys(WASD_KEYS)) this.keys.delete(k);
  }

  setEdgeScroll(on: boolean): void {
    this.opts.edgeScroll = on;
  }

  /** Apply key and edge scrolling for `dtSec` seconds. Called once per rendered frame. */
  update(dtSec: number): void {
    if (!this.enabled || dtSec <= 0) return;
    let dx = 0;
    let dy = 0;
    for (const k of this.keys) {
      const v = PAN_KEYS[k] ?? (this.opts.wasd ? WASD_KEYS[k] : undefined);
      if (v !== undefined) {
        dx += v[0];
        dy += v[1];
      }
    }
    let speed = this.opts.keySpeed;
    if (dx === 0 && dy === 0 && this.opts.edgeScroll && this.mouse !== null && this.drag === null) {
      const z = this.opts.edgeZone;
      const m = this.mouse;
      if (m.x >= 0 && m.y >= 0 && m.x <= this.camera.viewW && m.y <= this.camera.viewH) {
        if (m.x < z) dx = -1;
        else if (m.x > this.camera.viewW - z) dx = 1;
        if (m.y < z) dy = -1;
        else if (m.y > this.camera.viewH - z) dy = 1;
        speed = this.opts.edgeSpeed;
      }
    }
    if (dx === 0 && dy === 0) return;
    const len = Math.hypot(dx, dy);
    this.camera.scrollBy((dx / len) * speed * dtSec, (dy / len) * speed * dtSec);
  }

  destroy(): void {
    for (const c of this.cleanup) c();
    this.cleanup.length = 0;
  }
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (el === null || typeof el.tagName !== 'string') return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}
