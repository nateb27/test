import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UNIT_IDS } from '../../../src/client/art/catalog';
import { layerPixels, validateSheet, type SheetMeta } from '../../../src/client/art/sheet/meta';
import { decodeIndexedPng, type IndexedPng } from '../../../src/client/art/sheet/png';
import { teamRamp } from '../../../src/client/art/rendered/quantize';
import PALETTE from '../../../src/client/art/rendered/palette.json';

const DIR = 'src/client/art/sheets';
const BASE_STATES = ['idle', 'walk', 'attack', 'death', 'corpse'];
const VILLAGER_STATES = ['chop', 'mine', 'farm', 'forage', 'build', 'carryWood', 'carryFood', 'carryGold', 'carryStone'];
/** Committed sheets (PNG + JSON) must stay small: they are downloaded at every first start. */
const BUDGET_BYTES = 3.2 * 1024 * 1024;

const metaOf = (name: string): SheetMeta => JSON.parse(readFileSync(join(DIR, `${name}.json`), 'utf8')) as SheetMeta;
const pagesCache = new Map<string, IndexedPng[]>();
async function pagesOf(meta: SheetMeta): Promise<IndexedPng[]> {
  const hit = pagesCache.get(meta.name);
  if (hit !== undefined) return hit;
  const pages = await Promise.all(meta.pages.map((p) => decodeIndexedPng(new Uint8Array(readFileSync(join(DIR, p))))));
  pagesCache.set(meta.name, pages);
  return pages;
}

describe('pre-rendered sprite sheets', () => {
  it('stay within the download budget', () => {
    let total = 0;
    for (const f of readdirSync(DIR)) total += statSync(join(DIR, f)).size;
    expect(total).toBeLessThan(BUDGET_BYTES);
  });

  for (const unit of UNIT_IDS) {
    it(`${unit}: every state x 8 facings x frame exists, rects and anchors are valid`, async () => {
      const meta = metaOf(unit);
      const pages = await pagesOf(meta);
      expect(validateSheet(meta, pages)).toEqual([]);
      const want = unit === 'villager' ? [...BASE_STATES, ...VILLAGER_STATES] : BASE_STATES;
      for (const st of want) {
        const s = meta.states[st];
        expect(s, `${unit}.${st}`).toBeDefined();
        expect(s!.facings).toBe(8);
        expect(s!.f.length).toBe(8 * s!.frames);
      }
      expect(meta.states.walk!.frames).toBe(8);
      expect(meta.states.walk!.cycle).toBeGreaterThan(0);
      expect(meta.states.attack!.frames).toBeGreaterThanOrEqual(6);
      expect(meta.states.death!.frames).toBeGreaterThanOrEqual(6);
      expect(meta.states.death!.loop).toBe(false);
      expect(meta.states.corpse!.frames).toBe(1);
      // The ground anchor lies inside every standing frame's figure column (feet on the anchor).
      const [ax, ay] = meta.anchor;
      for (const fr of meta.states.idle!.f) {
        const [, , , , , , , bx0, by0, bx1, by1] = fr;
        expect(ax).toBeGreaterThanOrEqual(bx0 - 2);
        expect(ax).toBeLessThanOrEqual(bx1 + 2);
        expect(ay).toBeGreaterThan(by0);
        expect(Math.abs(ay - by1)).toBeLessThanOrEqual(unit === 'batteringRam' || unit === 'trebuchet' ? 30 : 6);
      }
      // Every unit carries some player colour in every facing of its idle pose.
      for (let f = 0; f < 8; f++) {
        const [pg, x, y, w, h] = meta.states.idle!.f[f * meta.states.idle!.frames]!;
        const png = pages[pg]!;
        let team = 0;
        for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
          const i = png.indices[(y + r) * png.width + x + c]!;
          if (i >= meta.team[0] && i < meta.team[0] + meta.team[1]) team++;
        }
        expect(team, `${unit} facing ${f}`).toBeGreaterThan(unit === 'trebuchet' ? 4 : 10);
      }
    });
  }

  for (const node of ['tree', 'berryBush']) {
    it(`${node}: variants are valid`, async () => {
      const meta = metaOf(node);
      expect(validateSheet(meta, await pagesOf(meta))).toEqual([]);
      expect(meta.variants).toBeGreaterThanOrEqual(2);
      for (let v = 0; v < meta.variants!; v++) expect(meta.states[`v${v}`]!.f.length).toBe(1);
    });
  }

  it('use only colours of the shared palette (plus ramp, shadow and outline entries)', async () => {
    const shared = new Set<number>();
    const P = PALETTE.shared;
    for (let i = 0; i < P.length; i += 3) shared.add((P[i]! << 16) | (P[i + 1]! << 8) | P[i + 2]!);
    for (const name of [...UNIT_IDS, 'tree', 'berryBush']) {
      const meta = metaOf(name);
      const used = new Set<number>();
      for (const png of await pagesOf(meta)) for (const i of png.indices) used.add(i);
      const png = (await pagesOf(meta))[0]!;
      const reserved = (i: number): boolean =>
        i === 0 ||
        (i >= meta.shadow[0] && i < meta.shadow[0] + meta.shadow[1]) ||
        (i >= meta.outline[0] && i < meta.outline[0] + meta.outline[1]) ||
        (i >= meta.team[0] && i < meta.team[0] + meta.team[1]);
      for (const i of used) {
        if (reserved(i)) continue;
        const rgb = (png.palette[i * 3]! << 16) | (png.palette[i * 3 + 1]! << 8) | png.palette[i * 3 + 2]!;
        expect(shared.has(rgb), `${name} index ${i}`).toBe(true);
      }
    }
  });
});

describe('player recolour', () => {
  it('red and blue differ exactly on the ramp pixels; the shadow layer is colour-free', async () => {
    const meta = metaOf('spearman');
    const png = (await pagesOf(meta))[0]!;
    const blue = layerPixels(png, meta, 'figure', teamRamp(0x2f5fbf));
    const red = layerPixels(png, meta, 'figure', teamRamp(0xc0392b));
    let team = 0;
    for (let p = 0; p < png.indices.length; p++) {
      const i = png.indices[p]!;
      const isTeam = i >= meta.team[0] && i < meta.team[0] + meta.team[1];
      const differs = blue[p * 4] !== red[p * 4] || blue[p * 4 + 1] !== red[p * 4 + 1] || blue[p * 4 + 2] !== red[p * 4 + 2];
      if (isTeam) team++;
      expect(differs).toBe(isTeam);
      if (isTeam) expect(red[p * 4]!).toBeGreaterThan(red[p * 4 + 2]!);
    }
    expect(team).toBeGreaterThan(500);
    const shadow = layerPixels(png, meta, 'shadow', null);
    for (let p = 0; p < png.indices.length; p++) {
      if (shadow[p * 4 + 3] === 0) continue;
      expect(shadow[p * 4]! + shadow[p * 4 + 1]! + shadow[p * 4 + 2]!).toBeLessThan(60);
      expect(blue[p * 4 + 3]).toBe(0);
    }
  });

  it('validation reports broken metadata', () => {
    const meta = metaOf('villager');
    const broken = { ...meta, anchor: [999, 999] as const, states: { idle: { ...meta.states.idle!, f: meta.states.idle!.f.slice(1) } } };
    const errs = validateSheet(broken);
    expect(errs.some((e) => e.includes('anchor'))).toBe(true);
    expect(errs.some((e) => e.includes('expected'))).toBe(true);
  });
});

describe('indexed PNG decoder', () => {
  it('decodes palette indices, palette and transparency', async () => {
    const meta = metaOf('tree');
    const png = (await pagesOf(meta))[0]!;
    expect(png.indices.length).toBe(png.width * png.height);
    expect(png.alpha[0]).toBe(0);
    expect(png.alpha[meta.shadow[0]]!).toBeLessThan(255);
    expect(png.alpha[meta.team[0]]!).toBe(255);
    await expect(decodeIndexedPng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).rejects.toThrow();
  });
});
