/**
 * Debug drawing over the world (plan 9.6): occupancy grid, unit paths,
 * approach tiles and the tile coordinates under the cursor, on one 2D canvas
 * laid over the Pixi canvas. Nothing is drawn (and nothing is allocated per
 * frame) while every toggle is off.
 */

import type { DataRegistry } from '../../data/schema';
import { buildOccupancy } from '../../sim/map/occupancy';
import type { EntityId, GameState, ReadonlyEntity, ReadonlyGameState, TilePos, Vec2 } from '../../sim/types';
import type { WorldRendererApi } from '../render/renderer';

export interface DebugToggles {
  occupancy: boolean;
  paths: boolean;
  approach: boolean;
  coords: boolean;
}

export const DEFAULT_TOGGLES: Readonly<DebugToggles> = { occupancy: false, paths: false, approach: false, coords: false };

export interface DebugLayerDeps {
  /** Element the canvas is added to (the game's canvas host). */
  parent: HTMLElement;
  renderer: Pick<WorldRendererApi, 'canvas' | 'worldToCanvas' | 'canvasToWorld' | 'visibleWorldCorners'>;
  registry: DataRegistry;
  getState(): ReadonlyGameState;
  selection(): readonly EntityId[];
}

/** Ring of tiles around a square footprint (the candidates of `approachTile`). */
export function ringTiles(tile: TilePos, size: number): TilePos[] {
  const out: TilePos[] = [];
  for (let y = tile.ty - 1; y <= tile.ty + size; y++) {
    for (let x = tile.tx - 1; x <= tile.tx + size; x++) {
      if (x !== tile.tx - 1 && x !== tile.tx + size && y !== tile.ty - 1 && y !== tile.ty + size) continue;
      out.push({ tx: x, ty: y });
    }
  }
  return out;
}

export class DebugLayer {
  readonly toggles: DebugToggles = { ...DEFAULT_TOGGLES };
  /** World point under the mouse (null until the mouse has moved over the canvas). */
  cursorWorld: Vec2 | null = null;
  readonly canvas: HTMLCanvasElement;

  private readonly g: CanvasRenderingContext2D;
  private readonly deps: DebugLayerDeps;
  private occupancy: Uint8Array | null = null;
  private occupancyFrame = -1000;
  private frame = 0;
  private readonly onMove: (e: MouseEvent) => void;

  constructor(deps: DebugLayerDeps) {
    this.deps = deps;
    const canvas = document.createElement('canvas');
    canvas.dataset.testid = 'debug-layer';
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;display:none;';
    const g = canvas.getContext('2d');
    if (g === null) throw new Error('2d canvas unavailable');
    this.canvas = canvas;
    this.g = g;
    deps.parent.appendChild(canvas);
    this.onMove = (e: MouseEvent): void => {
      const r = deps.renderer.canvas.getBoundingClientRect();
      this.cursorWorld = deps.renderer.canvasToWorld(e.clientX - r.left, e.clientY - r.top);
    };
    window.addEventListener('mousemove', this.onMove);
  }

  /** The tile under the mouse, or null. */
  get cursorTile(): TilePos | null {
    if (this.cursorWorld === null) return null;
    const { width, height } = this.deps.getState().map;
    const tx = Math.floor(this.cursorWorld.x);
    const ty = Math.floor(this.cursorWorld.y);
    return tx < 0 || ty < 0 || tx >= width || ty >= height ? null : { tx, ty };
  }

  get anyOn(): boolean {
    const t = this.toggles;
    return t.occupancy || t.paths || t.approach || t.coords;
  }

  /** Draw one frame (call once per rendered frame; cheap and allocation-light when everything is off). */
  update(): void {
    const { canvas, g, toggles } = this;
    if (!this.anyOn) {
      if (canvas.style.display !== 'none') canvas.style.display = 'none';
      return;
    }
    canvas.style.display = 'block';
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    this.frame++;
    const state = this.deps.getState();
    const view = this.visibleRange(state);
    let occTiles = 0;
    let pathCount = 0;
    let approachTiles = 0;
    if (toggles.occupancy) occTiles = this.drawOccupancy(state, view);
    if (toggles.approach) approachTiles = this.drawApproach(state);
    if (toggles.paths) pathCount = this.drawPaths(state);
    const cursor = toggles.coords ? this.drawCursor() : null;
    const d = canvas.dataset;
    d.occupancy = String(occTiles);
    d.paths = String(pathCount);
    d.approach = String(approachTiles);
    d.cursor = cursor === null ? '' : `${cursor.tx},${cursor.ty}`;
  }

  destroy(): void {
    window.removeEventListener('mousemove', this.onMove);
    this.canvas.remove();
  }

  // ------------------------------------------------------------ drawing

  private visibleRange(state: ReadonlyGameState): { x0: number; y0: number; x1: number; y1: number } {
    const corners = this.deps.renderer.visibleWorldCorners();
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const c of corners) {
      x0 = Math.min(x0, c.x);
      y0 = Math.min(y0, c.y);
      x1 = Math.max(x1, c.x);
      y1 = Math.max(y1, c.y);
    }
    const { width, height } = state.map;
    return {
      x0: Math.max(0, Math.floor(x0)),
      y0: Math.max(0, Math.floor(y0)),
      x1: Math.min(width - 1, Math.ceil(x1)),
      y1: Math.min(height - 1, Math.ceil(y1)),
    };
  }

  private tileDiamond(tx: number, ty: number): void {
    const { g } = this;
    const r = this.deps.renderer;
    const a = r.worldToCanvas(tx, ty);
    const b = r.worldToCanvas(tx + 1, ty);
    const c = r.worldToCanvas(tx + 1, ty + 1);
    const d = r.worldToCanvas(tx, ty + 1);
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.lineTo(c.x, c.y);
    g.lineTo(d.x, d.y);
    g.closePath();
  }

  /** Occupancy as the sim's blocking footprints, rebuilt at most every 15 frames. */
  private occupancyGrid(state: ReadonlyGameState): Uint8Array {
    if (this.occupancy === null || this.frame - this.occupancyFrame >= 15) {
      this.occupancy = buildOccupancy(state as GameState, this.deps.registry);
      this.occupancyFrame = this.frame;
    }
    return this.occupancy;
  }

  private drawOccupancy(state: ReadonlyGameState, v: { x0: number; y0: number; x1: number; y1: number }): number {
    const { g } = this;
    const occ = this.occupancyGrid(state);
    const { width } = state.map;
    g.fillStyle = 'rgba(255, 60, 40, 0.38)';
    g.strokeStyle = 'rgba(255, 220, 200, 0.55)';
    g.lineWidth = 1;
    let n = 0;
    for (let ty = v.y0; ty <= v.y1; ty++) {
      for (let tx = v.x0; tx <= v.x1; tx++) {
        if (occ[ty * width + tx] === 0) continue;
        this.tileDiamond(tx, ty);
        g.fill();
        g.stroke();
        n++;
      }
    }
    return n;
  }

  private footprintOf(e: ReadonlyEntity): { tile: TilePos; size: number } | null {
    if (e.kind === 'unit') return null;
    const def = e.kind === 'node' ? this.deps.registry.node(e.typeId) : this.deps.registry.building(e.typeId);
    return { tile: e.tile, size: def.footprint };
  }

  /** Walkable ring tiles around the selected buildings and nodes and around the targets of selected units' orders. */
  private drawApproach(state: ReadonlyGameState): number {
    const { g } = this;
    const occ = this.occupancyGrid(state);
    const { width, height } = state.map;
    const byId = new Map<EntityId, ReadonlyEntity>();
    for (const e of state.entities) byId.set(e.id, e);
    const targets: { tile: TilePos; size: number }[] = [];
    for (const id of this.deps.selection()) {
      const e = byId.get(id);
      if (e === undefined) continue;
      const fp = this.footprintOf(e);
      if (fp !== null) targets.push(fp);
      else if (e.kind === 'unit' && e.currentOrder !== null) {
        const o = e.currentOrder;
        const targetId = o.type === 'gather' ? o.targetId : o.type === 'build' || o.type === 'assist' ? o.buildingId : null;
        const t = targetId === null ? undefined : byId.get(targetId);
        const tfp = t === undefined ? null : this.footprintOf(t);
        if (tfp !== null) targets.push(tfp);
      }
    }
    g.fillStyle = 'rgba(70, 230, 120, 0.42)';
    g.strokeStyle = 'rgba(200, 255, 220, 0.8)';
    g.lineWidth = 1.5;
    let n = 0;
    for (const t of targets) {
      for (const { tx, ty } of ringTiles(t.tile, t.size)) {
        if (tx < 0 || ty < 0 || tx >= width || ty >= height || occ[ty * width + tx] !== 0) continue;
        this.tileDiamond(tx, ty);
        g.fill();
        g.stroke();
        n++;
      }
    }
    return n;
  }

  private drawPaths(state: ReadonlyGameState): number {
    const { g } = this;
    const r = this.deps.renderer;
    g.lineWidth = 2;
    g.lineJoin = 'round';
    let n = 0;
    for (const e of state.entities) {
      if (e.kind !== 'unit' || e.path === null) continue;
      const { waypoints, nextIndex } = e.path;
      if (nextIndex >= waypoints.length) continue;
      const start = r.worldToCanvas(e.pos.x, e.pos.y);
      g.strokeStyle = 'rgba(80, 220, 255, 0.9)';
      g.beginPath();
      g.moveTo(start.x, start.y);
      for (let i = nextIndex; i < waypoints.length; i++) {
        const p = r.worldToCanvas(waypoints[i]!.x, waypoints[i]!.y);
        g.lineTo(p.x, p.y);
      }
      g.stroke();
      const last = waypoints[waypoints.length - 1]!;
      const end = r.worldToCanvas(last.x, last.y);
      g.fillStyle = 'rgba(255, 240, 120, 0.95)';
      g.fillRect(end.x - 2.5, end.y - 2.5, 5, 5);
      n++;
    }
    return n;
  }

  private drawCursor(): TilePos | null {
    const tile = this.cursorTile;
    if (tile === null || this.cursorWorld === null) return null;
    const { g } = this;
    g.strokeStyle = '#ffe66d';
    g.lineWidth = 2;
    this.tileDiamond(tile.tx, tile.ty);
    g.stroke();
    const p = this.deps.renderer.worldToCanvas(tile.tx + 0.5, tile.ty + 0.5);
    const label = `${tile.tx}, ${tile.ty}`;
    g.font = 'bold 12px system-ui, sans-serif';
    const w = g.measureText(label).width + 10;
    g.fillStyle = 'rgba(15, 8, 25, 0.88)';
    g.fillRect(p.x - w / 2, p.y - 34, w, 18);
    g.fillStyle = '#ffe66d';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, p.x, p.y - 25);
    return tile;
  }
}
