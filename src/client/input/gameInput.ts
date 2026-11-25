/**
 * In-match pointer and keyboard handling (WP5). Turns DOM events on the game
 * canvas into client-side selection changes and `CommandInput`s. It never
 * touches sim state; commands go through the command buffer.
 *
 * Extension points for later work packages:
 * - HUD (WP9): `selection.subscribe`, `onCardSlot`, `triggerCardSlot`, `onUiAction`.
 * - Placement (WP10): `setMode` routes clicks, pointer moves and Esc to a mode
 *   (e.g. building placement) before selection and contextual orders see them.
 */

import { registry as defaultRegistry } from '../../data';
import type { DataRegistry } from '../../data/schema';
import type { CommandInput, EntityId, PlayerId, ReadonlyEntity, Sim, Vec2 } from '../../sim/types';
import type { WorldRendererApi } from '../render/renderer';
import { resolveContextCommands } from './contextual';
import { HOTKEYS, resolveHotkey, type HotkeyAction, type HotkeyBinding } from './hotkeys';
import {
  boxSelection,
  centroid,
  clickSelection,
  entityCentre,
  findTownCenter,
  nextIdleVillager,
  sameTypeSelection,
  trackClick,
  type ClickRecord,
  SelectionStore,
} from './selection';

export interface CommandSink {
  issue(input: CommandInput): unknown;
}

export interface GameInputDeps {
  sim: Sim;
  renderer: WorldRendererApi;
  commands: CommandSink;
  /** Pause flag of the fixed-tick loop. */
  loop: { paused: boolean };
  playerId: PlayerId;
  registry?: DataRegistry;
  hotkeys?: readonly HotkeyBinding[];
  /** Millisecond clock for the double-click, double-tap and demolish windows (default `performance.now`). */
  now?: () => number;
}

export interface CanvasPoint {
  /** CSS pixels relative to the canvas's top-left. */
  x: number;
  y: number;
}

export interface Modifiers {
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
}

/** A modal input handler (building placement). Return true from a handler to consume the event. */
export interface InputMode {
  onLeftClick?(p: CanvasPoint, mods: Modifiers): boolean;
  onRightClick?(p: CanvasPoint, mods: Modifiers): boolean;
  onPointerMove?(p: CanvasPoint, mods: Modifiers): void;
  /** Esc. Return true when something was cancelled. */
  onCancel?(): boolean;
}

/** Actions the input layer cannot perform itself and passes to the app/HUD. */
export type UiAction = 'menu' | 'toggleDebug' | 'confirmDemolish' | 'togglePause';

/** Pixels the pointer must travel before a press becomes a drag box. */
export const DRAG_THRESHOLD_PX = 4;
/** Max gap between two clicks (or two group-key taps) to count as a double. */
export const DOUBLE_CLICK_MS = 400;
/** Window in which a second Delete confirms demolishing completed buildings. */
export const DEMOLISH_CONFIRM_MS = 2000;

export class GameInput {
  readonly selection = new SelectionStore();
  /** Current drag box in canvas pixels, or null. Read by the drag-box overlay (`render/overlays`). */
  dragBox: { x0: number; y0: number; x1: number; y1: number } | null = null;

  private readonly sim: Sim;
  private readonly renderer: WorldRendererApi;
  private readonly commands: CommandSink;
  private readonly loop: { paused: boolean };
  private readonly playerId: PlayerId;
  private readonly registry: DataRegistry;
  private readonly hotkeys: readonly HotkeyBinding[];
  private readonly now: () => number;
  private readonly cleanup: (() => void)[] = [];
  private readonly cardListeners = new Set<(slot: number) => void>();
  private readonly uiListeners = new Set<(action: UiAction) => void>();
  private mode: InputMode | null = null;
  private press: { x: number; y: number; shift: boolean; dragging: boolean } | null = null;
  private lastClick: ClickRecord | null = null;
  private lastGroupTap: { group: number; time: number } | null = null;
  private lastIdle: EntityId | null = null;
  private pendingDemolish: { key: string; time: number } | null = null;

  constructor(deps: GameInputDeps) {
    this.sim = deps.sim;
    this.renderer = deps.renderer;
    this.commands = deps.commands;
    this.loop = deps.loop;
    this.playerId = deps.playerId;
    this.registry = deps.registry ?? defaultRegistry;
    this.hotkeys = deps.hotkeys ?? HOTKEYS;
    this.now = deps.now ?? ((): number => performance.now());
    // WASD would collide with the command-card grid (QWERT / ASDFG / ZXCVB).
    this.renderer.cameraInput.setWasd(false);

    const canvas = this.renderer.canvas;
    const listen = <T extends EventTarget>(t: T, type: string, fn: (e: never) => void): void => {
      t.addEventListener(type, fn as EventListener);
      this.cleanup.push(() => t.removeEventListener(type, fn as EventListener));
    };
    // No browser context menu on the canvas: right click is an order.
    listen(canvas, 'contextmenu', (e: MouseEvent) => e.preventDefault());
    listen(canvas, 'mousedown', (e: MouseEvent) => this.onMouseDown(e));
    listen(window, 'mousemove', (e: MouseEvent) => this.onMouseMove(e));
    listen(window, 'mouseup', (e: MouseEvent) => this.onMouseUp(e));
    listen(window, 'keydown', (e: KeyboardEvent) => this.onKeyDown(e));
    listen(window, 'blur', () => this.cancelPress());
  }

  // ---------------------------------------------------------------- API

  /** Route input to a modal handler (placement); pass null to restore normal input. */
  setMode(mode: InputMode | null): void {
    this.mode = mode;
    this.cancelPress();
  }

  /** Subscribe to command-card hotkeys (QWERT/ASDFG/ZXCVB -> slot 0..14). */
  onCardSlot(listener: (slot: number) => void): () => void {
    this.cardListeners.add(listener);
    return () => this.cardListeners.delete(listener);
  }

  /** Trigger a command-card slot as if its hotkey was pressed (the HUD calls this for button clicks). */
  triggerCardSlot(slot: number): void {
    for (const l of [...this.cardListeners]) l(slot);
  }

  /** Subscribe to actions the app must handle: open the menu (Esc), toggle the debug overlay (F3). */
  onUiAction(listener: (action: UiAction) => void): () => void {
    this.uiListeners.add(listener);
    return () => this.uiListeners.delete(listener);
  }

  /** Per-frame, before rendering: drop selected entities that no longer exist. */
  update(): void {
    this.selection.prune((id) => this.sim.query.entityById(id) !== undefined);
  }

  /** Right click at a canvas point with the current selection. Returns the commands issued. */
  issueContextOrder(p: CanvasPoint, shift: boolean): CommandInput[] {
    const picked = this.renderer.pickEntity(p.x, p.y);
    const target = picked === null ? null : (this.sim.query.entityById(picked) ?? null);
    const w = this.renderer.canvasToWorld(p.x, p.y);
    const size = this.sim.state.map.width;
    const point: Vec2 = { x: Math.min(size - 0.01, Math.max(0.01, w.x)), y: Math.min(this.sim.state.map.height - 0.01, Math.max(0.01, w.y)) };
    const cmds = resolveContextCommands({
      selected: this.selectedEntities(),
      target,
      point,
      shift,
      owner: this.playerId,
      registry: this.registry,
    });
    for (const c of cmds) this.commands.issue(c);
    return cmds;
  }

  /** Perform a hotkey action (also used directly by tests and the HUD). */
  perform(action: HotkeyAction): void {
    switch (action.type) {
      case 'selectTownCenter': {
        const tc = findTownCenter(this.sim.state.entities, this.playerId, this.registry);
        if (tc === null) return;
        this.selection.set([tc.id]);
        const c = entityCentre(tc, this.registry);
        this.renderer.jumpTo(c.x, c.y);
        return;
      }
      case 'cycleIdleVillager': {
        const id = nextIdleVillager(this.sim.state.entities, this.playerId, this.lastIdle, this.registry);
        this.lastIdle = id;
        if (id === null) return;
        this.selection.set([id]);
        const e = this.sim.query.entityById(id);
        if (e !== undefined) {
          const c = entityCentre(e, this.registry);
          this.renderer.jumpTo(c.x, c.y);
        }
        return;
      }
      case 'deleteSelection': {
        const own = this.selectedEntities().filter((e) => e.owner === this.playerId);
        if (own.length === 0) return;
        // Demolishing a completed building needs a second Delete within DEMOLISH_CONFIRM_MS; units go at once.
        if (own.some((e) => e.kind === 'building' && e.constructed)) {
          const key = own.map((e) => e.id).join(',');
          const now = this.now();
          const p = this.pendingDemolish;
          if (p === null || p.key !== key || now - p.time > DEMOLISH_CONFIRM_MS) {
            this.pendingDemolish = { key, time: now };
            this.emitUi('confirmDemolish');
            return;
          }
        }
        this.pendingDemolish = null;
        this.commands.issue({ type: 'delete', entityIds: own.map((e) => e.id) });
        return;
      }
      case 'cancel':
        if (this.press !== null) this.cancelPress();
        else if (this.mode?.onCancel?.() !== true) this.emitUi('menu');
        return;
      case 'togglePause':
        // The HUD owns pause (it ignores the key while the in-match menu holds the game paused).
        if (this.uiListeners.size > 0) this.emitUi('togglePause');
        else this.loop.paused = !this.loop.paused;
        return;
      case 'toggleDebug':
        this.emitUi('toggleDebug');
        return;
      case 'cardSlot':
        this.triggerCardSlot(action.slot);
        return;
      case 'assignGroup':
        this.selection.groups.assign(action.group, this.selection.ids);
        return;
      case 'recallGroup': {
        const exists = (id: EntityId): boolean => this.sim.query.entityById(id) !== undefined;
        const live = this.selection.groups.recall(action.group, exists);
        if (live.length === 0) return;
        const now = this.now();
        const again = this.lastGroupTap !== null && this.lastGroupTap.group === action.group && now - this.lastGroupTap.time <= DOUBLE_CLICK_MS;
        this.lastGroupTap = { group: action.group, time: now };
        this.selection.set(live);
        if (again) {
          const c = centroid(live, (id) => this.sim.query.entityById(id), this.registry);
          if (c !== null) this.renderer.jumpTo(c.x, c.y);
        }
        return;
      }
    }
  }

  destroy(): void {
    for (const c of this.cleanup) c();
    this.cleanup.length = 0;
    this.cardListeners.clear();
    this.uiListeners.clear();
  }

  // ------------------------------------------------------------ internals

  private selectedEntities(): ReadonlyEntity[] {
    const out: ReadonlyEntity[] = [];
    for (const id of this.selection.ids) {
      const e = this.sim.query.entityById(id);
      if (e !== undefined) out.push(e);
    }
    return out;
  }

  private lookup = (id: EntityId): ReadonlyEntity | undefined => this.sim.query.entityById(id);

  private emitUi(action: UiAction): void {
    for (const l of [...this.uiListeners]) l(action);
  }

  private toCanvas(e: MouseEvent): CanvasPoint {
    const r = this.renderer.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private cancelPress(): void {
    this.press = null;
    this.dragBox = null;
  }

  private onMouseDown(e: MouseEvent): void {
    const p = this.toCanvas(e);
    const mods: Modifiers = { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey };
    if (e.button === 0) {
      if (this.mode?.onLeftClick?.(p, mods) === true) return;
      this.press = { x: p.x, y: p.y, shift: e.shiftKey, dragging: false };
    } else if (e.button === 2) {
      e.preventDefault();
      if (this.mode?.onRightClick?.(p, mods) === true) return;
      this.issueContextOrder(p, e.shiftKey);
    }
  }

  private onMouseMove(e: MouseEvent): void {
    const p = this.toCanvas(e);
    this.mode?.onPointerMove?.(p, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey });
    const press = this.press;
    if (press === null) return;
    if (!press.dragging && Math.hypot(p.x - press.x, p.y - press.y) >= DRAG_THRESHOLD_PX) press.dragging = true;
    if (press.dragging) this.dragBox = { x0: press.x, y0: press.y, x1: p.x, y1: p.y };
  }

  private onMouseUp(e: MouseEvent): void {
    if (e.button !== 0 || this.press === null) return;
    const press = this.press;
    const p = this.toCanvas(e);
    this.cancelPress();
    if (press.dragging) {
      const boxed = this.renderer.entitiesInCanvasRect(press.x, press.y, p.x, p.y, ['unit']);
      this.selection.set(boxSelection(this.selection.ids, boxed, press.shift, this.playerId, this.lookup));
      this.lastClick = null;
      return;
    }
    this.click(p, press.shift);
  }

  private click(p: CanvasPoint, shift: boolean): void {
    const picked = this.renderer.pickEntity(p.x, p.y);
    const hit = picked === null ? null : (this.sim.query.entityById(picked) ?? null);
    const now = this.now();
    const { isDouble, next } = trackClick(this.lastClick, hit === null ? null : hit.id, shift, now);
    this.lastClick = next;
    if (hit !== null && isDouble && hit.owner === this.playerId && hit.kind !== 'node') {
      const cam = this.renderer.camera;
      const ids = this.renderer.entitiesInCanvasRect(0, 0, cam.viewW, cam.viewH, [hit.kind]);
      const visible: ReadonlyEntity[] = [];
      for (const id of ids) {
        const e = this.sim.query.entityById(id);
        if (e !== undefined) visible.push(e);
      }
      this.selection.set(sameTypeSelection(hit, visible, this.selection.ids, shift, this.playerId, this.lookup));
      return;
    }
    this.selection.set(clickSelection(this.selection.ids, hit, shift, this.playerId, this.lookup));
  }

  private onKeyDown(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (t !== null && typeof t.tagName === 'string' && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const action = resolveHotkey(this.hotkeys, e);
    if (action === null) return;
    if (e.repeat && (action.type === 'togglePause' || action.type === 'toggleDebug' || action.type === 'deleteSelection')) return;
    e.preventDefault();
    this.perform(action);
  }
}
