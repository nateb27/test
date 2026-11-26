/**
 * Atlas packing: rendered sprites (trimmed RGBA) are packed onto a few square pages with shelf packing and a
 * transparent gutter, then uploaded as one texture per page. Pure apart from the typed arrays it fills.
 */

import type { NamedSprite } from './jobs';

export const PAGE_SIZE = 2048;
/** Transparent pixels around every sprite so filtering never samples a neighbour. */
export const GUTTER = 2;

export interface Placement {
  page: number;
  x: number;
  y: number;
}

/** Shelf-pack rectangles (tallest first) onto pages of side `size`. Returns placements in input order and page heights used. */
export function packRects(rects: readonly { w: number; h: number }[], size = PAGE_SIZE, gutter = GUTTER): { placements: Placement[]; pageHeights: number[] } {
  const order = rects.map((_, i) => i).sort((a, b) => rects[b]!.h - rects[a]!.h || rects[b]!.w - rects[a]!.w || a - b);
  const placements: Placement[] = new Array<Placement>(rects.length);
  const pageHeights: number[] = [];
  let page = 0;
  let x = 0;
  let y = 0;
  let shelfH = 0;
  for (const i of order) {
    const w = rects[i]!.w + gutter * 2;
    const h = rects[i]!.h + gutter * 2;
    if (w > size || h > size) throw new Error(`sprite ${rects[i]!.w}x${rects[i]!.h} does not fit an atlas page`);
    if (x + w > size) {
      y += shelfH;
      x = 0;
      shelfH = 0;
    }
    if (y + h > size) {
      pageHeights[page] = y;
      page++;
      x = 0;
      y = 0;
      shelfH = 0;
    }
    placements[i] = { page, x: x + gutter, y: y + gutter };
    x += w;
    if (h > shelfH) shelfH = h;
  }
  pageHeights[page] = y + shelfH;
  return { placements, pageHeights };
}

/** Where a sprite ended up, plus what the manifest needs to make its texture. */
export interface AtlasEntry {
  name: string;
  page: number;
  /** Trimmed pixels' position on the page. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Full frame size, anchor and trim offset inside it. */
  fw: number;
  fh: number;
  ax: number;
  ay: number;
  tx: number;
  ty: number;
  /** First frame row with model pixels (-1: none). */
  top: number;
}

export interface AtlasPage {
  w: number;
  h: number;
  rgba: Uint8ClampedArray;
  /** Team pixels: (pixel index on the page << 4) | ramp level. */
  team: Uint32Array;
}

export interface Atlas {
  pages: AtlasPage[];
  entries: AtlasEntry[];
}

export function buildAtlas(sprites: readonly NamedSprite[], size = PAGE_SIZE): Atlas {
  const { placements, pageHeights } = packRects(sprites.map((s) => ({ w: s.sprite.tw, h: s.sprite.th })), size);
  const pages: AtlasPage[] = pageHeights.map((h) => ({ w: size, h: Math.max(1, h), rgba: new Uint8ClampedArray(size * Math.max(1, h) * 4), team: new Uint32Array(0) }));
  const teams: number[][] = pages.map(() => []);
  const entries: AtlasEntry[] = [];
  sprites.forEach((ns, i) => {
    const s = ns.sprite;
    const p = placements[i]!;
    const pg = pages[p.page]!;
    for (let row = 0; row < s.th; row++) {
      const src = row * s.tw * 4;
      pg.rgba.set(s.rgba.subarray(src, src + s.tw * 4), ((p.y + row) * pg.w + p.x) * 4);
    }
    const t = teams[p.page]!;
    for (const v of s.team) {
      const idx = v >>> 4;
      const lx = idx % s.tw;
      const ly = Math.floor(idx / s.tw);
      t.push((((p.y + ly) * pg.w + p.x + lx) << 4) | (v & 15));
    }
    entries.push({ name: ns.name, page: p.page, x: p.x, y: p.y, w: s.tw, h: s.th, fw: s.w, fh: s.h, ax: s.ax, ay: s.ay, tx: s.tx, ty: s.ty, top: s.top });
  });
  pages.forEach((pg, i) => {
    pg.team = Uint32Array.from(teams[i]!);
  });
  return { pages, entries };
}
