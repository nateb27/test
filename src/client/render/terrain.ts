/**
 * Terrain: grass tiles with seeded variants, baked into 16x16-tile chunk
 * textures on demand and culled to the viewport (plan 6).
 */

import { CanvasSource, Container, Sprite, Texture } from 'pixi.js';
import { mulberry } from '../art/draw';
import { TILE_H, TILE_W } from '../../sim/types';
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
}

export class TerrainLayer {
  readonly container = new Container();
  private chunks = new Map<number, Chunk>();
  private variantCanvases: HTMLCanvasElement[] | null = null;
  private frame = 0;
  private cols = 0;

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

  private bake(cx: number, cy: number, map: { width: number; height: number }, seed: number): Chunk {
    this.variantCanvases ??= makeVariantCanvases();
    const w = CHUNK_TILES * TILE_W + 2;
    const h = CHUNK_TILES * TILE_H + 2;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    const originX = worldToScreen(cx * CHUNK_TILES, cy * CHUNK_TILES + CHUNK_TILES).x - 1;
    const originY = worldToScreen(cx * CHUNK_TILES, cy * CHUNK_TILES).y - 1;
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
    const texture = new Texture({ source: new CanvasSource({ resource: canvas }) });
    const sprite = new Sprite(texture);
    sprite.position.set(originX, originY);
    this.container.addChild(sprite);
    return { sprite, texture, lastUsed: this.frame };
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

  update(rect: WorldPxRect, map: { width: number; height: number }, seed: number): void {
    this.frame++;
    this.cols = Math.ceil(map.width / CHUNK_TILES);
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
