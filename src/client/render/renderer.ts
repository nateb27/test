/**
 * World renderer (WP3): PixiJS v8 canvas with camera, cached terrain chunks,
 * the depth-sorted entity layer and picking helpers.
 *
 * `WorldRenderer` is the contract; `WorldRendererApi` adds the camera, layers
 * and picking that WP5 (input), WP9/WP10 (overlays, minimap) build on.
 */

import { Application, Container, UPDATE_PRIORITY } from 'pixi.js';
import { DEBUG_HOOKS_ENABLED } from '../debug/hook';
import { perf } from '../debug/perf';
import type { AssetManifest, UnitAnimState } from '../art/manifest';
import { registry as defaultRegistry } from '../../data';
import type { DataRegistry } from '../../data/schema';
import { TICK_RATE, type EntityId, type ReadonlyGameState, type SimEvent, type Vec2 } from '../../sim/types';
import { Camera, CameraInput, type CameraInputOptions, type WorldPxRect } from './camera';
import { EntityLayer, footprintOf, type DrawnEntity } from './entities';
import { mapScreenBounds, screenToWorld, worldToScreen, type ScreenPoint } from './iso';
import { pickDrawn, pickRect } from './picking';
import { TerrainLayer } from './terrain';
import { drawOnChange } from './redraw';

export interface WorldRenderer {
  readonly canvas: HTMLCanvasElement;
  /**
   * Draw the state. `alpha` in [0, 1) interpolates unit positions between
   * `prevPos` and `pos`.
   */
  render(state: ReadonlyGameState, alpha: number): void;
  /** World tiles -> CSS pixels relative to the canvas's top-left, through the camera. */
  worldToCanvas(x: number, y: number): ScreenPoint;
  /** CSS pixels relative to the canvas -> world tiles, through the camera. */
  canvasToWorld(cx: number, cy: number): Vec2;
  destroy(): void;
}

/** The named containers, back to front, all in world-pixel space (they move with the camera). */
export interface RenderLayers {
  /** Cached terrain chunks. */
  readonly terrain: Container;
  /** Selection rings, rally lines, placement footprint: drawn above terrain, below entities. WP10 fills this. */
  readonly groundOverlays: Container;
  /** Depth-sorted entity sprites. */
  readonly entities: Container;
  /** Progress bars, carried-resource icons, click markers: drawn above entities. WP10 fills this. */
  readonly worldOverlays: Container;
}

export interface WorldRendererApi extends WorldRenderer {
  readonly camera: Camera;
  readonly cameraInput: CameraInput;
  readonly layers: RenderLayers;
  /** Centre the camera on a world position (tiles). Used by the minimap and hotkeys. */
  jumpTo(x: number, y: number): void;
  /** Entity under a canvas point (CSS px) from the last rendered frame: units over buildings over nodes. */
  pickEntity(cx: number, cy: number): EntityId | null;
  /** Entities (units by default) whose anchor falls inside a canvas rectangle, for box select. */
  entitiesInCanvasRect(x0: number, y0: number, x1: number, y1: number, kinds?: readonly DrawnEntity['kind'][]): EntityId[];
  /** Canvas-space bounding box (CSS px) of an entity drawn last frame, or null if off screen. */
  entityCanvasBounds(id: EntityId): { x: number; y: number; w: number; h: number } | null;
  /** The four world-tile corners of the visible area (for the minimap's camera outline), clockwise from top. */
  visibleWorldCorners(): [Vec2, Vec2, Vec2, Vec2];
  /** Entities drawn on the last frame, back to front. */
  readonly lastDrawn: readonly DrawnEntity[];
  /** Label of the texture an entity was drawn with on the last frame, or null (debug and tests). */
  drawnTexture(id: EntityId): string | null;
  /** Feed a tick's events to the decal and effect layer (corpses, rubble, hit effects). PLAN-M2 3.8, 7.2. */
  pushEvents(events: readonly SimEvent[]): void;
  /** What the effect layer holds and drew on the last frame (debug hook `effects()`). */
  effectStats(): EffectStats;
  /** Optional: force a unit's animation state, null clears (dev/e2e art previews of attack, death, corpse). */
  previewAnimation?(id: EntityId, state: UnitAnimState | null): void;
  /** Optional: draw one entity in another player colour, null clears (dev/e2e art previews). */
  previewColour?(id: EntityId, primary: number | null): void;
}

/** Counts reported by `WorldRendererApi.effectStats`. */
export interface EffectStats {
  projectiles: number;
  corpses: number;
  rubble: number;
  fires: number;
  effects: number;
}

export interface RendererOptions {
  parent: HTMLElement;
  manifest: AssetManifest;
  /** Map size in tiles, for the camera bounds and initial position. */
  mapWidth: number;
  mapHeight: number;
  /** Content registry (defaults to the game data). Missing defs fall back gracefully. */
  registry?: DataRegistry;
  /** Initial camera centre in world tiles. Default: the first non-neutral player's first building, else the map centre. */
  focus?: Vec2;
  cameraInput?: CameraInputOptions;
  /** Canvas size override (default: the window). Mainly for tests and screenshots. */
  size?: { width: number; height: number };
  /** Start with this zoom (0.5 - 2). */
  zoom?: number;
}

const BACKGROUND = 0x10170c;

/** Create the renderer. Resolves once the Pixi canvas is attached to `parent`. */
export async function createWorldRenderer(options: RendererOptions): Promise<WorldRendererApi> {
  const registry = options.registry ?? defaultRegistry;
  const app = new Application();
  await app.init({
    ...(options.size !== undefined ? { width: options.size.width, height: options.size.height } : { resizeTo: window }),
    background: BACKGROUND,
    antialias: false,
    autoDensity: true,
    resolution: window.devicePixelRatio || 1,
  });
  app.canvas.classList.add('world-canvas');
  options.parent.appendChild(app.canvas);
  // Draw only frames whose scene changed (a paused, idle world costs no GPU time; see redraw.ts).
  drawOnChange(app);

  if (DEBUG_HOOKS_ENABLED) {
    // Time Pixi's own draw (scene graph traversal and command submission) between the first and last ticker callbacks.
    let t0 = 0;
    app.ticker.add(() => void (t0 = perf.start()), null, UPDATE_PRIORITY.HIGH);
    app.ticker.add(() => perf.end('pixi.render', t0), null, UPDATE_PRIORITY.UTILITY);
  }

  const camera = new Camera();
  const b = mapScreenBounds(options.mapWidth, options.mapHeight);
  const pad = 96;
  camera.setBounds({ minX: b.minX - pad, maxX: b.maxX + pad, minY: b.minY - pad, maxY: b.maxY + pad });
  camera.setViewport(app.screen.width, app.screen.height);
  camera.zoomAt(app.screen.width / 2, app.screen.height / 2, options.zoom ?? 1);
  const focus = options.focus ?? { x: options.mapWidth / 2, y: options.mapHeight / 2 };
  camera.jumpTo(focus.x, focus.y);
  let needsAutoFocus = options.focus === undefined;

  const world = new Container();
  const terrain = new TerrainLayer(options.manifest.terrain?.() ?? null, (e) => footprintOf(registry, e));
  const groundOverlays = new Container();
  const entities = new EntityLayer(options.manifest, registry);
  const worldOverlays = new Container();
  world.addChild(terrain.container, entities.shadows, groundOverlays, entities.container, worldOverlays);
  app.stage.addChild(world);
  const cameraInput = new CameraInput(camera, app.canvas, options.cameraInput);

  let lastNow = performance.now();

  const api: WorldRendererApi = {
    canvas: app.canvas,
    camera,
    cameraInput,
    layers: { terrain: terrain.container, groundOverlays, entities: entities.container, worldOverlays },
    get lastDrawn() {
      return entities.drawn;
    },
    render(state, alpha) {
      const now = performance.now();
      const dt = Math.min(0.1, (now - lastNow) / 1000);
      lastNow = now;
      camera.setViewport(app.screen.width, app.screen.height);
      if (needsAutoFocus) {
        needsAutoFocus = false;
        const mine = state.entities.find((e) => e.kind === 'building' && e.owner !== 0);
        if (mine !== undefined && mine.kind === 'building') {
          const def = registry.def(mine.typeId);
          const size = def !== undefined && def.kind === 'building' ? def.footprint : 4;
          camera.jumpTo(mine.tile.tx + size / 2, mine.tile.ty + size / 2);
        }
      }
      cameraInput.update(dt);
      world.position.set(app.screen.width / 2 - camera.x * camera.zoom, app.screen.height / 2 - camera.y * camera.zoom);
      world.scale.set(camera.zoom);
      const rect = camera.visibleRect();
      const t0 = perf.start();
      terrain.update(rect, state.map, state.mapSeed, state.entities);
      const t1 = perf.start();
      perf.end('render.terrain', t0);
      // Sprite animations run on game time (tick + alpha), so a paused match is a still picture (and is not redrawn).
      entities.update(state, alpha, rect, ((state.tick + alpha) * 1000) / TICK_RATE);
      perf.end('render.entities', t1);
    },
    worldToCanvas: (x, y) => camera.worldToCanvas(x, y),
    canvasToWorld: (cx, cy) => camera.canvasToWorld(cx, cy),
    jumpTo: (x, y) => camera.jumpTo(x, y),
    pickEntity(cx, cy) {
      const p = camera.canvasToWorldPx(cx, cy);
      return pickDrawn(entities.drawn, p.x, p.y);
    },
    entitiesInCanvasRect(x0, y0, x1, y1, kinds) {
      const a = camera.canvasToWorldPx(Math.min(x0, x1), Math.min(y0, y1));
      const c = camera.canvasToWorldPx(Math.max(x0, x1), Math.max(y0, y1));
      return pickRect(entities.drawn, { minX: a.x, minY: a.y, maxX: c.x, maxY: c.y }, worldToScreen, kinds);
    },
    drawnTexture: (id) => entities.drawnTexture(id),
    // STUB (TODO(WP27)): the decal and effect layer; until then events are ignored and nothing is counted.
    pushEvents: () => {},
    effectStats: () => ({ projectiles: 0, corpses: 0, rubble: 0, fires: 0, effects: 0 }),
    previewAnimation: (id, state) => entities.previewAnimation(id, state),
    previewColour: (id, primary) => entities.previewColour(id, primary),
    entityCanvasBounds(id) {
      const d = entities.getDrawn(id);
      if (d === undefined) return null;
      const a = camera.worldPxToCanvas(d.bounds.minX, d.bounds.minY);
      const c = camera.worldPxToCanvas(d.bounds.maxX, d.bounds.maxY);
      return { x: a.x, y: a.y, w: c.x - a.x, h: c.y - a.y };
    },
    visibleWorldCorners() {
      const r: WorldPxRect = camera.visibleRect();
      return [screenToWorld(r.minX, r.minY), screenToWorld(r.maxX, r.minY), screenToWorld(r.maxX, r.maxY), screenToWorld(r.minX, r.maxY)];
    },
    destroy() {
      cameraInput.destroy();
      terrain.destroy();
      entities.destroy();
      app.destroy({ removeView: true }, { children: true });
    },
  };
  return api;
}
