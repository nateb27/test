/**
 * Small baked textures for the overlays. Everything is drawn once to a canvas
 * and tinted per use, so the per-frame work is only sprite property writes.
 * Baked white with a dark under-stroke so tints stay legible on any terrain.
 */

import { CanvasSource, Texture } from 'pixi.js';

/** Supersampling of the baked canvases (matches the art pipeline). */
const SS = 2;

function bake(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): { texture: Texture; canvas: HTMLCanvasElement } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w * SS);
  canvas.height = Math.ceil(h * SS);
  const g = canvas.getContext('2d');
  if (g === null) throw new Error('2d canvas unavailable');
  g.scale(SS, SS);
  draw(g);
  return { texture: new Texture({ source: new CanvasSource({ resource: canvas, resolution: SS }) }), canvas };
}

const DARK = 'rgba(8,10,6,0.65)';

function diamond(g: CanvasRenderingContext2D, cx: number, cy: number, hw: number, hh: number): void {
  g.beginPath();
  g.moveTo(cx, cy - hh);
  g.lineTo(cx + hw, cy);
  g.lineTo(cx, cy + hh);
  g.lineTo(cx - hw, cy);
  g.closePath();
}

export class OverlayTextures {
  private readonly all: Texture[] = [];
  private readonly outlines = new Map<number, Texture>();

  /** Unit selection ring (ellipse, 2:1), 44 x 24 logical px, anchor centre. */
  readonly ring = this.track(
    bake(44, 24, (g) => {
      g.beginPath();
      g.ellipse(22, 12, 19, 9.5, 0, 0, Math.PI * 2);
      g.lineWidth = 4;
      g.strokeStyle = DARK;
      g.stroke();
      g.lineWidth = 2;
      g.strokeStyle = '#fff';
      g.stroke();
    }).texture,
  );

  /** Order-marker ring (larger, thinner), 64 x 34 logical px. */
  readonly pulse = this.track(
    bake(64, 34, (g) => {
      g.beginPath();
      g.ellipse(32, 17, 29, 14.5, 0, 0, Math.PI * 2);
      g.lineWidth = 4.5;
      g.strokeStyle = DARK;
      g.stroke();
      g.lineWidth = 2.5;
      g.strokeStyle = '#fff';
      g.stroke();
    }).texture,
  );

  /** One tile diamond (64 x 32), inset 1 px so neighbouring tiles show a seam. Filled white. */
  readonly tile = this.track(
    bake(64, 32, (g) => {
      diamond(g, 32, 16, 31, 15.5);
      g.fillStyle = '#fff';
      g.fill();
    }).texture,
  );

  /** Small round marker for carried resources (10 x 10 logical, dark rim, white body). */
  readonly dot = this.track(
    bake(10, 10, (g) => {
      g.beginPath();
      g.arc(5, 5, 4.5, 0, Math.PI * 2);
      g.fillStyle = 'rgba(8,10,6,0.85)';
      g.fill();
      g.beginPath();
      g.arc(5, 5, 3.2, 0, Math.PI * 2);
      g.fillStyle = '#fff';
      g.fill();
    }).texture,
  );

  /** Rally flag: pole plus pennant, anchored at the pole's foot (bottom-left). 18 x 26 logical. */
  readonly flag = this.track(
    bake(18, 26, (g) => {
      g.lineWidth = 3;
      g.strokeStyle = DARK;
      g.beginPath();
      g.moveTo(3, 25);
      g.lineTo(3, 2);
      g.stroke();
      g.beginPath();
      g.moveTo(3, 2);
      g.lineTo(16, 7);
      g.lineTo(3, 12);
      g.closePath();
      g.fillStyle = DARK;
      g.fill();
      g.stroke();
      g.fillStyle = '#fff';
      g.strokeStyle = '#fff';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(3, 24);
      g.lineTo(3, 3);
      g.stroke();
      g.beginPath();
      g.moveTo(3.5, 3.5);
      g.lineTo(14, 7);
      g.lineTo(3.5, 10.5);
      g.closePath();
      g.fill();
    }).texture,
  );

  /** Footprint outline for a square of `size` tiles: diamond of 64*size x 32*size, anchor centre. */
  outline(size: number): Texture {
    let t = this.outlines.get(size);
    if (t === undefined) {
      const pad = 4;
      const w = 64 * size + pad * 2;
      const h = 32 * size + pad * 2;
      t = this.track(
        bake(w, h, (g) => {
          diamond(g, w / 2, h / 2, 32 * size - 1, 16 * size - 0.5);
          g.fillStyle = 'rgba(255,255,255,0.10)';
          g.fill();
          g.lineWidth = 4;
          g.strokeStyle = DARK;
          g.stroke();
          g.lineWidth = 2;
          g.strokeStyle = '#fff';
          g.stroke();
        }).texture,
      );
      this.outlines.set(size, t);
    }
    return t;
  }

  private track(t: Texture): Texture {
    this.all.push(t);
    return t;
  }

  destroy(): void {
    for (const t of this.all) t.destroy(true);
    this.all.length = 0;
    this.outlines.clear();
  }
}
