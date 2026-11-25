/**
 * World renderer contract and the WP0 placeholder implementation (an empty,
 * full-window Pixi canvas). WP3 replaces the internals: terrain chunks,
 * entity layer with interpolation, camera, picking.
 */

import { Application } from 'pixi.js';
import type { AssetManifest } from '../art/manifest';
import type { ReadonlyGameState, Vec2 } from '../../sim/types';
import { screenToWorld, worldToScreen, type ScreenPoint } from './iso';

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

export interface RendererOptions {
  parent: HTMLElement;
  manifest: AssetManifest;
  /** Map size in tiles, for the initial camera position. */
  mapWidth: number;
  mapHeight: number;
}

const BACKGROUND = 0x10170c;

/** Create the renderer. Resolves once the Pixi canvas is attached to `parent`. */
export async function createWorldRenderer(options: RendererOptions): Promise<WorldRenderer> {
  const app = new Application();
  await app.init({
    resizeTo: window,
    background: BACKGROUND,
    antialias: false,
    autoDensity: true,
    resolution: window.devicePixelRatio || 1,
  });
  app.canvas.classList.add('world-canvas');
  options.parent.appendChild(app.canvas);

  // Placeholder camera: map centre at canvas centre, zoom 1.
  const centre = worldToScreen(options.mapWidth / 2, options.mapHeight / 2);
  const offset = (): ScreenPoint => ({
    x: app.screen.width / 2 - centre.x,
    y: app.screen.height / 2 - centre.y,
  });

  return {
    canvas: app.canvas,
    render: () => {
      // Pixi's ticker renders the (empty) stage. WP3 draws the world here.
    },
    worldToCanvas: (x, y) => {
      const s = worldToScreen(x, y);
      const o = offset();
      return { x: s.x + o.x, y: s.y + o.y };
    },
    canvasToWorld: (cx, cy) => {
      const o = offset();
      return screenToWorld(cx - o.x, cy - o.y);
    },
    destroy: () => app.destroy({ removeView: true }, { children: true }),
  };
}
