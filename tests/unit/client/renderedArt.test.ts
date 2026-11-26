import { describe, expect, it } from 'vitest';
import { UNIT_IDS } from '../../../src/client/art/catalog';
import { GUTTER, buildAtlas, packRects } from '../../../src/client/art/rendered/atlas';
import { cacheKey, fnv1a } from '../../../src/client/art/rendered/cache';
import { allJobs, buildingFrame, isEssential, unitStateSource, type NamedSprite } from '../../../src/client/art/rendered/jobs';
import { M, isTeam } from '../../../src/client/art/rendered/materials';
import { BUILDING_LOOKS, lookFor } from '../../../src/client/art/rendered/models/looks';
import { fbm2p, hash2p, vn2p } from '../../../src/client/art/rendered/noise';
import { PALETTE_RGB } from '../../../src/client/art/rendered/paletteData';
import { groundAt, projectX, projectY, ZS } from '../../../src/client/art/rendered/project';
import { Quantizer, SHARED_COLOURS, TEAM_LEVELS, addToHistogram, ditherMasked, medianCut, teamRamp } from '../../../src/client/art/rendered/quantize';
import { castPrimary, hit, occluded } from '../../../src/client/art/rendered/raycast';
import { renderSprite, runToEnd, type SpriteOut } from '../../../src/client/art/rendered/render';
import { PERIOD, TEX_H, TEX_W } from '../../../src/client/art/rendered/terrainTex';
import { Model, PAD } from '../../../src/client/art/rendered/voxel';
import { worldToScreen } from '../../../src/client/render/iso';
import { apronsOf, pickTexture } from '../../../src/client/render/terrain';
import { registry } from '../../../src/data';
import type { ReadonlyEntity } from '../../../src/sim/types';

describe('projection', () => {
  it('matches the game projection on the ground and inverts it', () => {
    for (const [x, y] of [
      [0, 0],
      [3.5, 5.5],
      [-2.25, 7],
      [119, 1],
    ] as const) {
      const s = worldToScreen(x, y);
      expect(projectX(x, y)).toBeCloseTo(s.x, 9);
      expect(projectY(x, y, 0)).toBeCloseTo(s.y, 9);
      const g = groundAt(s.x, s.y);
      expect(g.x).toBeCloseTo(x, 9);
      expect(g.y).toBeCloseTo(y, 9);
    }
  });

  it('lifts height straight up the screen', () => {
    expect(projectX(2, 3)).toBe(projectX(2, 3));
    expect(projectY(2, 3, 1) - projectY(2, 3, 0)).toBeCloseTo(-ZS, 9);
  });

  it('terrain textures are a whole number of map periods', () => {
    expect(TEX_W).toBe(64 * PERIOD);
    expect(TEX_H).toBe(32 * PERIOD);
  });
});

describe('periodic noise', () => {
  it('repeats exactly', () => {
    for (const [x, y] of [
      [0.3, 0.7],
      [5.1, 2.9],
    ] as const) {
      expect(vn2p(x + 8, y, 8)).toBeCloseTo(vn2p(x, y, 8), 12);
      expect(vn2p(x, y - 16, 8)).toBeCloseTo(vn2p(x, y, 8), 12);
      expect(fbm2p(x + 6, y + 6, 6, 3)).toBeCloseTo(fbm2p(x, y, 6, 3), 12);
    }
    expect(hash2p(3, 4, 10)).toBe(hash2p(13, -6, 10));
  });
});

describe('voxel models', () => {
  it('adds, carves and paints in grid-local coordinates', () => {
    const m = new Model(-1, -1, 2, 2, 1, 10);
    m.box(0.5, 0.5, 0, 1.5, 1.5, 0.5, M.RUBBLE);
    const at = (x: number, y: number, z: number): number => m.mat[Math.floor(x * 10) + m.nx * (Math.floor(y * 10) + m.ny * (Math.floor(z * 10) + PAD))]!;
    expect(at(1, 1, 0.25)).toBe(M.RUBBLE);
    expect(at(0.2, 0.2, 0.25)).toBe(0);
    m.paintBox(0, 0, 0.3, 2, 2, 1, M.BRICK);
    expect(at(1, 1, 0.45)).toBe(M.BRICK);
    expect(at(0.2, 0.2, 0.45)).toBe(0); // paint never creates material
    m.carveBox(0.9, 0.9, 0, 1.1, 1.1, 1);
    expect(at(1, 1, 0.25)).toBe(0);
    // Hidden ground fill under the model.
    expect(m.mat[0]).toBe(1);
  });

  it('clones independently and finds the box of visible voxels', () => {
    const m = new Model(0, 0, 2, 2, 1, 10);
    m.box(0.5, 0.6, 0, 1.0, 1.2, 0.4, M.ASHLAR);
    const c = m.clone();
    c.carveBox(0, 0, 0, 2, 2, 1);
    expect(m.hasContent()).toBe(true);
    expect(c.hasContent()).toBe(false);
    m.finalize();
    expect(m.bx0).toBe(5);
    expect(m.bx1).toBe(9);
    expect(m.by0).toBe(6);
    expect(m.by1).toBe(11);
    expect(m.bz1).toBe(PAD + 3);
    expect(m.top![7 + m.nx * 8]).toBeCloseTo(0.4, 6);
  });
});

describe('ray casting', () => {
  const m = new Model(-1, -1, 2, 2, 1, 16);
  m.box(0.75, 0.75, 0, 1.25, 1.25, 0.5, M.ASHLAR);
  m.finalize();

  it('a view ray through the block hits it, one beside it does not', () => {
    // Screen point of the block's top centre: world (0, 0, 0.5) -> ground point under it along the view ray.
    const sy = projectY(0, 0, 0.5);
    const g = groundAt(0, sy);
    expect(castPrimary(m, g.x, g.y, 0)).toBe(true);
    expect(hit.mat).toBe(M.ASHLAR);
    expect(hit.axis).toBe(2);
    const far = groundAt(200, 0);
    expect(castPrimary(m, far.x, far.y, 0)).toBe(false);
  });

  it('shadow rays are blocked by the block only on the sun side', () => {
    expect(occluded(m, -0.6, 0, 0.01, 1, 0, 0.3)).toBe(true);
    expect(occluded(m, -0.6, 0, 0.01, -1, 0, 0.3)).toBe(false);
  });
});

describe('palette', () => {
  it('has 240 fitted colours plus a 16-step team ramp', () => {
    expect(SHARED_COLOURS + TEAM_LEVELS).toBe(256);
    expect(PALETTE_RGB.length).toBe(SHARED_COLOURS * 3);
    const ramp = teamRamp(0x6a2c91);
    expect(ramp.length).toBe(TEAM_LEVELS * 3);
    const lum = (i: number): number => ramp[i * 3]! + ramp[i * 3 + 1]! + ramp[i * 3 + 2]!;
    for (let i = 1; i < TEAM_LEVELS; i++) expect(lum(i)).toBeGreaterThanOrEqual(lum(i - 1));
  });

  it('median cut and nearest colour', () => {
    const hist = new Uint32Array(32768);
    const px = [10, 20, 30, 200, 100, 50, 12, 22, 31, 250, 250, 250];
    addToHistogram(hist, px, 3);
    const pal = medianCut(hist, 3);
    expect(pal.length).toBeLessThanOrEqual(9);
    const q = new Quantizer([0, 0, 0, 255, 255, 255, 255, 0, 0]);
    expect(q.nearest(250, 240, 245)).toBe(1);
    expect(q.nearest(200, 30, 20)).toBe(2);
    expect(q.nearest(-20, 3, 400)).toBeGreaterThanOrEqual(0);
  });

  it('dithers only masked pixels, to palette colours', () => {
    const q = new Quantizer([0, 0, 0, 255, 255, 255]);
    const rgb = new Float32Array([128, 128, 128, 128, 128, 128, 77, 66, 55, 128, 128, 128]);
    ditherMasked(rgb, Uint8Array.from([1, 1, 0, 1]), 4, 1, q, 1);
    const on = [0, 1, 3].map((i) => rgb[i * 3]);
    for (const v of on) expect(v === 0 || v === 255).toBe(true);
    expect(on).toContain(0);
    expect(on).toContain(255);
    expect([rgb[6], rgb[7], rgb[8]]).toEqual([77, 66, 55]);
  });
});

describe('atlas', () => {
  it('packs without overlap inside pages, with a gutter', () => {
    const rects = Array.from({ length: 300 }, (_, i) => ({ w: 5 + ((i * 37) % 120), h: 4 + ((i * 53) % 90) }));
    const { placements, pageHeights } = packRects(rects, 512);
    const boxes = placements.map((p, i) => ({ ...p, w: rects[i]!.w, h: rects[i]!.h }));
    for (const b of boxes) {
      expect(b.x).toBeGreaterThanOrEqual(GUTTER);
      expect(b.x + b.w).toBeLessThanOrEqual(512 - GUTTER);
      expect(b.y + b.h).toBeLessThanOrEqual(pageHeights[b.page]!);
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        if (a.page !== b.page) continue;
        const apart = a.x + a.w + GUTTER <= b.x || b.x + b.w + GUTTER <= a.x || a.y + a.h + GUTTER <= b.y || b.y + b.h + GUTTER <= a.y;
        expect(apart).toBe(true);
      }
    }
  });

  it('copies pixels and team pixels to their page position', () => {
    const sprite: SpriteOut = { w: 4, h: 4, ax: 2, ay: 3, tx: 1, ty: 1, tw: 2, th: 1, rgba: Uint8ClampedArray.from([1, 2, 3, 255, 4, 5, 6, 255]), team: Uint32Array.from([(1 << 4) | 7]), top: 1 };
    const s: NamedSprite[] = [{ name: 'a', sprite }];
    const atlas = buildAtlas(s, 64);
    const e = atlas.entries[0]!;
    const pg = atlas.pages[0]!;
    expect(Array.from(pg.rgba.slice((e.y * pg.w + e.x + 1) * 4, (e.y * pg.w + e.x + 1) * 4 + 4))).toEqual([4, 5, 6, 255]);
    expect(pg.team[0]! >>> 4).toBe(e.y * pg.w + e.x + 1);
    expect(pg.team[0]! & 15).toBe(7);
  });
});

describe('cache key', () => {
  it('changes with the art sources, the palette and the job list', () => {
    const jobs = allJobs();
    const k = cacheKey('abc', PALETTE_RGB, jobs);
    expect(cacheKey('abc', PALETTE_RGB, jobs)).toBe(k);
    expect(cacheKey('abd', PALETTE_RGB, jobs)).not.toBe(k);
    expect(cacheKey('abc', [...PALETTE_RGB, 1], jobs)).not.toBe(k);
    expect(cacheKey('abc', PALETTE_RGB, jobs.slice(1))).not.toBe(k);
    expect(fnv1a('')).toBe('811c9dc5');
  });
});

describe('looks and jobs', () => {
  it('every building has a look for every age it can exist in, and the late ones do not appear early', () => {
    for (const b of registry.buildings) {
      for (let age = b.age; age <= 4; age++) {
        const look = lookFor(b.id as never, age);
        expect(look.key).toBe(b.id);
        expect(look.ages).toContain(age);
      }
    }
    expect(BUILDING_LOOKS.filter((l) => l.key === 'townCenter')).toHaveLength(4);
    expect(lookFor('house', 1).late).toBe(false);
    expect(lookFor('house', 4).late).toBe(true);
  });

  it('jobs cover every unit state and the first age renders first', () => {
    const jobs = allJobs();
    for (const key of UNIT_IDS) {
      for (const state of ['idle', 'walk', 'work', 'carry'] as const) {
        const src = unitStateSource(key, state);
        expect(jobs.some((j) => j.type === 'unit' && j.key === key && j.state === src)).toBe(true);
      }
    }
    const essential = jobs.filter(isEssential);
    expect(essential.some((j) => j.type === 'building' && j.look === 'townCenter.a1')).toBe(true);
    expect(essential.some((j) => j.type === 'building' && j.look === 'townCenter.a4')).toBe(false);
    expect(essential.some((j) => j.type === 'terrain')).toBe(true);
    const f = buildingFrame('townCenter');
    expect(f.w).toBeGreaterThan(256);
    expect(f.ax).toBeGreaterThan(0);
  });
});

describe('sprite renderer', () => {
  it('renders an opaque model with a baked shadow and team pixels', () => {
    const m = new Model(-0.6, -0.6, 1.2, 1.2, 1, 20);
    m.box(0.4, 0.4, 0, 0.8, 0.8, 0.6, M.ASHLAR);
    m.box(0.4, 0.8, 0.2, 0.8, 0.83, 0.5, M.BLUE);
    const s = runToEnd(renderSprite({ models: [m], ss: 2 }));
    let opaque = 0;
    let shadow = 0;
    for (let i = 0; i < s.tw * s.th; i++) {
      const a = s.rgba[i * 4 + 3]!;
      if (a === 255) opaque++;
      else if (a > 0) {
        shadow++;
        // Shadow pixels are pure black with alpha (identical premultiplied or not).
        expect([s.rgba[i * 4], s.rgba[i * 4 + 1], s.rgba[i * 4 + 2]]).toEqual([0, 0, 0]);
      }
    }
    expect(opaque).toBeGreaterThan(100);
    expect(shadow).toBeGreaterThan(20);
    expect(s.team.length).toBeGreaterThan(0);
    expect(isTeam(M.BLUE)).toBe(true);
    // The model top is measured on the model, above the anchor.
    expect(s.top).toBeGreaterThanOrEqual(0);
    expect(s.top).toBeLessThan(s.ay);
    // Opaque pixels use palette colours (or the team ramp).
    const pal = new Set<string>();
    for (let i = 0; i < PALETTE_RGB.length; i += 3) pal.add(`${PALETTE_RGB[i]},${PALETTE_RGB[i + 1]},${PALETTE_RGB[i + 2]}`);
    const teamIdx = new Set(Array.from(s.team, (v) => v >>> 4));
    for (let i = 0; i < s.tw * s.th; i++) {
      if (s.rgba[i * 4 + 3] !== 255 || teamIdx.has(i)) continue;
      expect(pal.has(`${s.rgba[i * 4]},${s.rgba[i * 4 + 1]},${s.rgba[i * 4 + 2]}`)).toBe(true);
    }
  });
});

describe('terrain mix', () => {
  it('picks worn earth near buildings and grass far away', () => {
    expect(pickTexture(0.9, 0, 0, 0)).toBe(3);
    expect(pickTexture(0.4, 0, 0, 0)).toBe(2);
    expect(pickTexture(0, 0.9, 0, 0)).toBe(2);
    expect(pickTexture(0, 0, 0.2, 0)).toBe(0);
    expect(pickTexture(0, 0, 0.8, 0)).toBe(1);
  });

  it('aprons come from buildings and deposits only', () => {
    const ents = [
      { kind: 'building', typeId: 'house', tile: { tx: 4, ty: 6 } },
      { kind: 'node', typeId: 'tree', tile: { tx: 1, ty: 1 } },
      { kind: 'node', typeId: 'goldDeposit', tile: { tx: 9, ty: 9 } },
    ] as unknown as ReadonlyEntity[];
    const a = apronsOf(ents, (e) => (e.kind === 'unit' ? 0 : e.typeId === 'tree' ? 1 : 2));
    expect(a).toHaveLength(2);
    expect(a[0]).toMatchObject({ x0: 4, y0: 6, x1: 6, y1: 8 });
  });
});
