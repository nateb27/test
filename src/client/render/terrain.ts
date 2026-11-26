/**
 * Terrain: grass baked into 16x16-tile chunk textures on demand and culled to the viewport (plan 6).
 *
 * Two sources: the procedural grass tiles with seeded variants, or (when the manifest provides `TerrainArt`) the
 * rendered seamless textures. With the latter every chunk pixel copies one texture's pixel, chosen by low-frequency
 * world noise (lush, second lush, dry grass) and by worn-earth aprons around buildings, farms and deposits, so the
 * terrain stays in the art's palette. A chunk is re-baked only when the aprons touching it change (a building is
 * placed or removed), never per frame.
 */

import { CanvasSource, Container, Sprite, Texture } from 'pixi.js';
import { DEFAULT_FOOTPRINT } from '../art/catalog';
import { mulberry } from '../art/draw';
import type { TerrainArt } from '../art/manifest';
import { TILE_H, TILE_W, type ReadonlyEntity } from '../../sim/types';
import type { WorldPxRect } from './camera';
import { screenToWorld, worldToScreen } from './iso';

export const CHUNK_TILES = 16;
const VARIANTS = 4;
/** At most this many chunk textures stay alive (each is 1024x512). */
const MAX_LIVE_CHUNKS = 30;

/** Deterministic per-tile hash. */
export function tileHash(tx: number, ty: number, seed: number): number {
  let h = Math.imul(tx, 73856093) ^ Math.imul(ty, 19349663) ^ Math.imul(seed | 0, 83492791);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  return (h ^ (h >>> 15)) >>> 0;
}

/** Which of the `variants` grass looks a tile uses. Variant 0 is the most common. */
export function grassVariant(tx: number, ty: number, seed: number, variants = VARIANTS): number {
  if (variants <= 1) return 0;
  const r = tileHash(tx, ty, seed) % 100;
  if (r < 52) return 0;
  const rest = variants - 1;
  return 1 + Math.min(rest - 1, Math.floor(((r - 52) / 48) * rest));
}

function makeVariantCanvases(): HTMLCanvasElement[] {
  const out: HTMLCanvasElement[] = [];
  const w = TILE_W + 2;
  const h = TILE_H + 2;
  const bases = ['#5b9a3c', '#579538', '#5f9e40', '#528f35'];
  for (let v = 0; v < VARIANTS; v++) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    const cx = w / 2;
    const cy = h / 2;
    const path = (): void => {
      ctx.beginPath();
      ctx.moveTo(cx, cy - TILE_H / 2 - 0.5);
      ctx.lineTo(cx + TILE_W / 2 + 0.5, cy);
      ctx.lineTo(cx, cy + TILE_H / 2 + 0.5);
      ctx.lineTo(cx - TILE_W / 2 - 0.5, cy);
      ctx.closePath();
    };
    path();
    ctx.fillStyle = bases[v]!;
    ctx.fill();
    ctx.save();
    path();
    ctx.clip();
    const rnd = mulberry(1000 + v * 77);
    // Speckle.
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = rnd() < 0.5 ? 'rgba(30,70,20,0.18)' : 'rgba(170,220,110,0.16)';
      ctx.fillRect(Math.floor(rnd() * w), Math.floor(rnd() * h), 2, 1);
    }
    if (v === 1) {
      // Grass tufts.
      ctx.strokeStyle = 'rgba(35,85,25,0.55)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 5; i++) {
        const x = 12 + rnd() * (w - 24);
        const y = 8 + rnd() * (h - 14);
        ctx.beginPath();
        ctx.moveTo(x - 2, y);
        ctx.lineTo(x - 1, y - 4);
        ctx.moveTo(x, y);
        ctx.lineTo(x, y - 5);
        ctx.moveTo(x + 2, y);
        ctx.lineTo(x + 1, y - 4);
        ctx.stroke();
      }
    } else if (v === 2) {
      // Tiny flowers.
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = i % 2 === 0 ? 'rgba(250,246,220,0.85)' : 'rgba(245,215,90,0.85)';
        ctx.fillRect(14 + rnd() * (w - 30), 8 + rnd() * (h - 16), 2, 2);
      }
    } else if (v === 3) {
      // Darker patch.
      ctx.fillStyle = 'rgba(30,75,25,0.12)';
      ctx.beginPath();
      ctx.ellipse(cx + (rnd() - 0.5) * 16, cy + (rnd() - 0.5) * 6, 14, 6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    // Very faint tile edge so the grid reads.
    path();
    ctx.strokeStyle = 'rgba(20,50,15,0.10)';
    ctx.lineWidth = 1;
    ctx.stroke();
    out.push(c);
  }
  return out;
}

interface Chunk {
  sprite: Sprite;
  texture: Texture;
  lastUsed: number;
  /** Signature of the aprons it was baked with. */
  aprons: string;
}

/** Worn ground around something on the map: a tile rectangle, how far the wear reaches, and its strength. */
export interface Apron {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  reach: number;
  strength: number;
}

/** Apron reach (tiles) per building / node type; any other building gets the default. */
const APRON_REACH: Readonly<Record<string, number>> = {
  townCenter: 1.0,
  farm: 0.3,
  goldDeposit: 0.55,
  stoneDeposit: 0.55,
  house: 0.45,
  mill: 0.6,
  lumberCamp: 0.75,
  miningCamp: 0.75,
};

/** Aprons for the buildings and deposits in an entity list (trees and berry bushes get none). */
export function apronsOf(entities: readonly ReadonlyEntity[], footprint: (e: ReadonlyEntity) => number): Apron[] {
  const out: Apron[] = [];
  for (const e of entities) {
    if (e.kind === 'unit') continue;
    if (e.kind === 'node' && e.typeId !== 'goldDeposit' && e.typeId !== 'stoneDeposit') continue;
    const size = footprint(e);
    const reach = APRON_REACH[e.typeId] ?? 0.6;
    out.push({ x0: e.tile.tx, y0: e.tile.ty, x1: e.tile.tx + size, y1: e.tile.ty + size, reach, strength: e.typeId === 'farm' ? 0.85 : 0.95 });
  }
  return out;
}

const defaultFootprint = (e: ReadonlyEntity): number => (e.kind === 'unit' ? 0 : (DEFAULT_FOOTPRINT[e.typeId] ?? 1));

/** Smooth value noise for the terrain mix. */
function vnoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let fx = x - xi;
  let fy = y - yi;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = tileHash(xi, yi, seed) / 4294967296;
  const b = tileHash(xi + 1, yi, seed) / 4294967296;
  const c = tileHash(xi, yi + 1, seed) / 4294967296;
  const d = tileHash(xi + 1, yi + 1, seed) / 4294967296;
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Field cell size in chunk pixels: the mix fields are evaluated on this grid; the per-pixel pick only thresholds. */
const CELL = 4;

/** Which rendered texture a terrain pixel shows: 0 grass, 1 second grass, 2 dry grass, 3 worn earth. */
export function pickTexture(dirt: number, dry: number, alt: number, jitter: number): 0 | 1 | 2 | 3 {
  const d = dirt + jitter;
  if (d > 0.52) return 3;
  if (d > 0.36) return 2;
  if (dry + jitter * 0.8 > 0.6) return 2;
  return alt + jitter > 0.5 ? 1 : 0;
}

export class TerrainLayer {
  readonly container = new Container();
  private chunks = new Map<number, Chunk>();
  private variantCanvases: HTMLCanvasElement[] | null = null;
  private frame = 0;
  private cols = 0;
  private aprons: Apron[] = [];
  private apronSource: readonly unknown[] | null = null;
  private apronSourceLength = -1;
  /** Chunk bakes so far (tests: placing a building re-bakes only the chunks it touches). */
  bakes = 0;

  constructor(
    private readonly art: TerrainArt | null = null,
    private readonly footprint: (e: ReadonlyEntity) => number = defaultFootprint,
  ) {}

  /** Number of chunk textures currently alive (for tests/debug). */
  get liveChunks(): number {
    return this.chunks.size;
  }

  /** Number of chunk sprites currently visible. */
  get visibleChunks(): number {
    let n = 0;
    for (const c of this.chunks.values()) if (c.sprite.visible) n++;
    return n;
  }

  /** Aprons overlapping a chunk, as a signature string ('' when none). */
  private apronKey(cx: number, cy: number): string {
    const x0 = cx * CHUNK_TILES;
    const y0 = cy * CHUNK_TILES;
    let key = '';
    for (const a of this.aprons) {
      if (a.x1 + a.reach < x0 - 1 || a.x0 - a.reach > x0 + CHUNK_TILES + 1 || a.y1 + a.reach < y0 - 1 || a.y0 - a.reach > y0 + CHUNK_TILES + 1) continue;
      key += `${a.x0},${a.y0},${a.x1},${a.y1};`;
    }
    return key;
  }

  private bakeArt(art: TerrainArt, cx: number, cy: number, map: { width: number; height: number }, seed: number, canvas: HTMLCanvasElement, originX: number, originY: number): void {
    const w = canvas.width;
    const h = canvas.height;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(w, h);
    const out = img.data;
    const gw = Math.ceil(w / CELL) + 2;
    const gh = Math.ceil(h / CELL) + 2;
    const fDirt = new Float32Array(gw * gh);
    const fDry = new Float32Array(gw * gh);
    const fAlt = new Float32Array(gw * gh);
    const x0 = cx * CHUNK_TILES - 2;
    const y0 = cy * CHUNK_TILES - 2;
    const local = this.aprons.filter((a) => !(a.x1 + a.reach < x0 || a.x0 - a.reach > x0 + CHUNK_TILES + 4 || a.y1 + a.reach < y0 || a.y0 - a.reach > y0 + CHUNK_TILES + 4));
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        const p = screenToWorld(originX + gx * CELL, originY + gy * CELL);
        const wob = (vnoise(p.x * 1.7, p.y * 1.7, seed + 7) - 0.5) * 0.45;
        let v = 0;
        for (const a of local) {
          const dx = Math.max(a.x0 - p.x, 0, p.x - a.x1);
          const dy = Math.max(a.y0 - p.y, 0, p.y - a.y1);
          const d = Math.sqrt(dx * dx + dy * dy) + wob * 0.8;
          const t = Math.min(1, Math.max(0, d / a.reach));
          const k = (1 - t * t * (3 - 2 * t)) * a.strength;
          if (k > v) v = k;
        }
        const i = gx + gw * gy;
        fDirt[i] = v > 0 ? v + wob * 0.35 : 0;
        fDry[i] = vnoise(p.x * 0.07, p.y * 0.07, seed + 11) * 0.75 + vnoise(p.x * 0.23, p.y * 0.23, seed + 13) * 0.25;
        fAlt[i] = vnoise(p.x * 0.13, p.y * 0.13, seed + 17);
      }
    }
    const TW = art.width;
    const TH = art.height;
    const tex = [art.grass, art.grass2, art.dry, art.dirt];
    const mapW = map.width;
    const mapH = map.height;
    for (let py = 0; py < h; py++) {
      const sy = originY + py;
      const v = ((sy % TH) + TH) % TH;
      const gy = Math.floor(py / CELL);
      const fy = py / CELL - gy;
      const b = sy / (TILE_H / 2);
      for (let px = 0; px < w; px++) {
        const sx = originX + px;
        // Outside the map stays transparent.
        const a = sx / (TILE_W / 2);
        const wx = (a + b) / 2;
        const wy = (b - a) / 2;
        if (wx < 0 || wy < 0 || wx >= mapW || wy >= mapH) continue;
        const gx = Math.floor(px / CELL);
        const fx = px / CELL - gx;
        const i = gx + gw * gy;
        const f00 = 1 - fx - fy + fx * fy;
        const f10 = fx - fx * fy;
        const f01 = fy - fx * fy;
        const f11 = fx * fy;
        const lerp = (f: Float32Array): number => f[i]! * f00 + f[i + 1]! * f10 + f[i + gw]! * f01 + f[i + gw + 1]! * f11;
        // Per-pixel jitter makes ragged, dithered borders between the textures.
        const j = ((tileHash(sx, sy, 977) & 1023) / 1023 - 0.5) * 0.16;
        const t = pickTexture(lerp(fDirt), lerp(fDry), lerp(fAlt), j);
        const u = ((sx % TW) + TW) % TW;
        const src = tex[t]!;
        const si = (u + TW * v) * 4;
        const di = (px + w * py) * 4;
        out[di] = src[si]!;
        out[di + 1] = src[si + 1]!;
        out[di + 2] = src[si + 2]!;
        out[di + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  private bake(cx: number, cy: number, map: { width: number; height: number }, seed: number): Chunk {
    this.bakes++;
    const w = CHUNK_TILES * TILE_W + 2;
    const h = CHUNK_TILES * TILE_H + 2;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const originX = worldToScreen(cx * CHUNK_TILES, cy * CHUNK_TILES + CHUNK_TILES).x - 1;
    const originY = worldToScreen(cx * CHUNK_TILES, cy * CHUNK_TILES).y - 1;
    let aprons = '';
    if (this.art !== null) {
      aprons = this.apronKey(cx, cy);
      this.bakeArt(this.art, cx, cy, map, seed, canvas, originX, originY);
    } else {
      this.variantCanvases ??= makeVariantCanvases();
      const ctx = canvas.getContext('2d')!;
      for (let ly = 0; ly < CHUNK_TILES; ly++) {
        for (let lx = 0; lx < CHUNK_TILES; lx++) {
          const tx = cx * CHUNK_TILES + lx;
          const ty = cy * CHUNK_TILES + ly;
          if (tx >= map.width || ty >= map.height) continue;
          const s = worldToScreen(tx + 0.5, ty + 0.5);
          const v = grassVariant(tx, ty, seed);
          ctx.drawImage(this.variantCanvases[v]!, s.x - originX - TILE_W / 2 - 1, s.y - originY - TILE_H / 2 - 1);
        }
      }
    }
    const texture = new Texture({ source: new CanvasSource({ resource: canvas }) });
    const sprite = new Sprite(texture);
    sprite.position.set(originX, originY);
    this.container.addChild(sprite);
    return { sprite, texture, lastUsed: this.frame, aprons };
  }

  /** Tile index range [x0..x1] x [y0..y1] of chunks touching a world-pixel rect. */
  static visibleChunkRange(rect: WorldPxRect, map: { width: number; height: number }): { x0: number; x1: number; y0: number; y1: number } {
    const corners = [
      screenToWorld(rect.minX, rect.minY),
      screenToWorld(rect.maxX, rect.minY),
      screenToWorld(rect.minX, rect.maxY),
      screenToWorld(rect.maxX, rect.maxY),
    ];
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const c of corners) {
      minX = Math.min(minX, c.x);
      maxX = Math.max(maxX, c.x);
      minY = Math.min(minY, c.y);
      maxY = Math.max(maxY, c.y);
    }
    const maxCx = Math.max(0, Math.ceil(map.width / CHUNK_TILES) - 1);
    const maxCy = Math.max(0, Math.ceil(map.height / CHUNK_TILES) - 1);
    return {
      x0: Math.max(0, Math.floor(minX / CHUNK_TILES)),
      x1: Math.min(maxCx, Math.floor(maxX / CHUNK_TILES)),
      y0: Math.max(0, Math.floor(minY / CHUNK_TILES)),
      y1: Math.min(maxCy, Math.floor(maxY / CHUNK_TILES)),
    };
  }

  update(rect: WorldPxRect, map: { width: number; height: number }, seed: number, entities: readonly ReadonlyEntity[] = []): void {
    this.frame++;
    this.cols = Math.ceil(map.width / CHUNK_TILES);
    if (this.art !== null && (entities !== this.apronSource || entities.length !== this.apronSourceLength)) {
      // The entity set changed (ids are never reused: additions change the length, removals replace the array):
      // recompute the aprons and drop the chunks whose aprons changed; they re-bake when next visible.
      this.apronSource = entities;
      this.apronSourceLength = entities.length;
      this.aprons = apronsOf(entities, this.footprint);
      for (const [key, c] of this.chunks) {
        if (this.apronKey(key % this.cols, Math.floor(key / this.cols)) !== c.aprons) {
          c.sprite.destroy();
          c.texture.destroy(true);
          this.chunks.delete(key);
        }
      }
    }
    const r = TerrainLayer.visibleChunkRange(rect, map);
    for (const c of this.chunks.values()) c.sprite.visible = false;
    for (let cy = r.y0; cy <= r.y1; cy++) {
      for (let cx = r.x0; cx <= r.x1; cx++) {
        const key = cy * this.cols + cx;
        let chunk = this.chunks.get(key);
        if (chunk === undefined) {
          chunk = this.bake(cx, cy, map, seed);
          this.chunks.set(key, chunk);
        }
        chunk.sprite.visible = true;
        chunk.lastUsed = this.frame;
      }
    }
    if (this.chunks.size > MAX_LIVE_CHUNKS) {
      const old = [...this.chunks.entries()].filter(([, c]) => !c.sprite.visible).sort((a, b) => a[1].lastUsed - b[1].lastUsed);
      for (const [key, c] of old) {
        if (this.chunks.size <= MAX_LIVE_CHUNKS) break;
        c.sprite.destroy();
        c.texture.destroy(true);
        this.chunks.delete(key);
      }
    }
  }

  destroy(): void {
    for (const c of this.chunks.values()) {
      c.sprite.destroy();
      c.texture.destroy(true);
    }
    this.chunks.clear();
  }
}
