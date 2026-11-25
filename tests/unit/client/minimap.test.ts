import { describe, expect, it } from 'vitest';
import { cameraOutline, clampToMap, createMinimapView, insideDiamond, minimapToWorld, worldToMinimap } from '../../../src/client/ui/minimap/geometry';
import { Camera } from '../../../src/client/render/camera';
import { screenToWorld } from '../../../src/client/render/iso';
import { barFor, markerForCommand, markerLook, MarkerRing, MARKER_LIFE_MS, MAX_MARKERS } from '../../../src/client/render/overlays/logic';
import { registry } from '../../../src/data';
import { makeBuilding, makeNode } from '../../../src/client/render/dev/fixtureState';

describe('minimap projection', () => {
  const sizes: [number, number][] = [[240, 124], [200, 100], [300, 80], [120, 60]];

  it.each(sizes)('fits the whole map diamond into %ix%i', (w, h) => {
    const v = createMinimapView(120, 120, w, h);
    const corners = [worldToMinimap(v, 0, 0), worldToMinimap(v, 120, 0), worldToMinimap(v, 120, 120), worldToMinimap(v, 0, 120)];
    for (const c of corners) {
      expect(c.x).toBeGreaterThanOrEqual(-1e-9);
      expect(c.x).toBeLessThanOrEqual(w + 1e-9);
      expect(c.y).toBeGreaterThanOrEqual(-1e-9);
      expect(c.y).toBeLessThanOrEqual(h + 1e-9);
    }
    // Top vertex is (0, 0), right is (120, 0), bottom (120, 120), left (0, 120).
    expect(corners[0]!.y).toBeLessThan(corners[1]!.y);
    expect(corners[1]!.x).toBeGreaterThan(corners[0]!.x);
    expect(corners[2]!.y).toBeGreaterThan(corners[1]!.y);
    expect(corners[3]!.x).toBeLessThan(corners[0]!.x);
  });

  it('world -> minimap -> world round trips, and the other way', () => {
    const v = createMinimapView(120, 120, 240, 124);
    for (let x = 0; x <= 120; x += 13.7) {
      for (let y = 0; y <= 120; y += 9.1) {
        const p = worldToMinimap(v, x, y);
        const w = minimapToWorld(v, p.x, p.y);
        expect(w.x).toBeCloseTo(x, 9);
        expect(w.y).toBeCloseTo(y, 9);
      }
    }
    for (let px = 0; px <= 240; px += 17) {
      for (let py = 0; py <= 124; py += 11) {
        const w = minimapToWorld(v, px, py);
        const p = worldToMinimap(v, w.x, w.y);
        expect(p.x).toBeCloseTo(px, 9);
        expect(p.y).toBeCloseTo(py, 9);
      }
    }
  });

  it('works for non-square maps', () => {
    const v = createMinimapView(80, 40, 240, 124);
    const w = minimapToWorld(v, ...(Object.values(worldToMinimap(v, 33, 12)) as [number, number]));
    expect(w).toEqual({ x: expect.closeTo(33, 9), y: expect.closeTo(12, 9) });
  });

  it('the map centre is the canvas centre', () => {
    const v = createMinimapView(120, 120, 240, 124);
    const c = worldToMinimap(v, 60, 60);
    expect(c.x).toBeCloseTo(120, 9);
    expect(c.y).toBeCloseTo(62, 9);
  });

  it('clamps clicks outside the diamond onto the map and detects the diamond', () => {
    const v = createMinimapView(120, 120, 240, 124);
    expect(insideDiamond(v, 120, 62)).toBe(true);
    expect(insideDiamond(v, 2, 2)).toBe(false);
    const w = minimapToWorld(v, 2, 2);
    const c = clampToMap(v, w);
    expect(c.x).toBeGreaterThanOrEqual(0);
    expect(c.y).toBeGreaterThanOrEqual(0);
    expect(clampToMap(v, { x: -5, y: 500 })).toEqual({ x: 0, y: 120 });
  });

  it('a click maps to the world point the camera then centres on', () => {
    const v = createMinimapView(120, 120, 240, 124);
    const cam = new Camera();
    cam.setViewport(1280, 720);
    const click = { x: 150, y: 70 };
    const w = clampToMap(v, minimapToWorld(v, click.x, click.y));
    cam.jumpTo(w.x, w.y);
    const centre = cam.canvasToWorld(640, 360);
    expect(centre.x).toBeCloseTo(w.x, 6);
    expect(centre.y).toBeCloseTo(w.y, 6);
  });
});

describe('camera outline', () => {
  it('maps the four visible corners; it is a screen-aligned rectangle centred on the camera', () => {
    const v = createMinimapView(120, 120, 240, 124);
    const cam = new Camera();
    cam.setViewport(1280, 720);
    cam.jumpTo(40, 70);
    const r = cam.visibleRect();
    const corners: [ReturnType<typeof screenToWorld>, ReturnType<typeof screenToWorld>, ReturnType<typeof screenToWorld>, ReturnType<typeof screenToWorld>] = [
      screenToWorld(r.minX, r.minY),
      screenToWorld(r.maxX, r.minY),
      screenToWorld(r.maxX, r.maxY),
      screenToWorld(r.minX, r.maxY),
    ];
    const o = cameraOutline(v, corners);
    // Axis-aligned in minimap pixels because the minimap uses the same projection.
    expect(o[0].y).toBeCloseTo(o[1].y, 9);
    expect(o[2].y).toBeCloseTo(o[3].y, 9);
    expect(o[0].x).toBeCloseTo(o[3].x, 9);
    expect(o[1].x).toBeCloseTo(o[2].x, 9);
    // Centred on the camera's world point.
    const c = worldToMinimap(v, 40, 70);
    expect((o[0].x + o[2].x) / 2).toBeCloseTo(c.x, 6);
    expect((o[0].y + o[2].y) / 2).toBeCloseTo(c.y, 6);
    // Size: the viewport in world pixels times k / 64 (32 world px per tile-diagonal unit map to k minimap px).
    expect(o[1].x - o[0].x).toBeCloseTo((1280 / 32) * v.k, 6);
    expect(o[3].y - o[0].y).toBeCloseTo((720 / 32) * v.k, 6);
  });

  it('zooming out grows the outline', () => {
    const v = createMinimapView(120, 120, 240, 124);
    const cam = new Camera();
    cam.setViewport(1280, 720);
    const width = (): number => {
      const r = cam.visibleRect();
      const o = cameraOutline(v, [screenToWorld(r.minX, r.minY), screenToWorld(r.maxX, r.minY), screenToWorld(r.maxX, r.maxY), screenToWorld(r.minX, r.maxY)]);
      return o[1].x - o[0].x;
    };
    const w1 = width();
    cam.zoomAt(640, 360, 0.5);
    expect(width()).toBeCloseTo(w1 * 2, 6);
  });
});

describe('overlay logic', () => {
  it('construction bar for own unfinished buildings, production bar for own queues, none for others', () => {
    const site = makeBuilding(1, 1, 'house', 10, 10, 0.4);
    expect(barFor(site, 1)).toEqual({ kind: 'construction', fraction: 0.4 });
    expect(barFor(site, 2)).toBeNull();
    const done = makeBuilding(2, 1, 'barracks', 20, 20);
    expect(barFor(done, 1)).toBeNull();
    const busy = {
      ...done,
      queue: [{ kind: 'unit' as const, unitType: 'spearman', costPaid: { food: 0, wood: 0, gold: 0, stone: 0 }, ticksDone: 30, ticksTotal: 120, popCapNotified: false }],
    };
    expect(barFor(busy, 1)).toEqual({ kind: 'production', fraction: 0.25 });
    expect(barFor(makeNode(3, 'tree', 1, 1), 1)).toBeNull();
  });

  it('order markers: where each command points', () => {
    const tree = makeNode(5, 'tree', 3, 3);
    const gold = makeNode(6, 'goldDeposit', 10, 10);
    const site = makeBuilding(7, 1, 'house', 30, 30, 0.2);
    const all = [tree, gold, site];
    const lookup = (id: number) => all.find((e) => e.id === id);
    expect(markerForCommand({ type: 'move', unitIds: [1], x: 4.5, y: 6, queue: false }, lookup, registry)).toEqual({ kind: 'move', x: 4.5, y: 6 });
    expect(markerForCommand({ type: 'gather', unitIds: [1], nodeId: 6, queue: false }, lookup, registry)).toEqual({ kind: 'gather', x: 11, y: 11 });
    expect(markerForCommand({ type: 'assist', unitIds: [1], buildingId: 7, queue: false }, lookup, registry)).toEqual({ kind: 'build', x: 31, y: 31 });
    expect(markerForCommand({ type: 'build', unitIds: [1], buildingType: 'house', tx: 40, ty: 40, queue: true }, lookup, registry)).toEqual({ kind: 'build', x: 41, y: 41 });
    expect(markerForCommand({ type: 'gather', unitIds: [1], nodeId: 999, queue: false }, lookup, registry)).toBeNull();
    expect(markerForCommand({ type: 'stop', unitIds: [1] }, lookup, registry)).toBeNull();
  });

  it('marker ring: fades over its life, reuses the oldest slot, and never grows', () => {
    const ring = new MarkerRing();
    ring.add({ kind: 'move', x: 1, y: 2 }, 1000);
    expect(ring.age(0, 1000)).toBe(0);
    expect(ring.age(0, 1000 + MARKER_LIFE_MS / 2)).toBeCloseTo(0.5, 9);
    expect(ring.age(0, 1000 + MARKER_LIFE_MS)).toBe(-1);
    expect(ring.age(1, 1000)).toBe(-1); // empty slot
    for (let i = 0; i < MAX_MARKERS + 3; i++) ring.add({ kind: 'gather', x: i, y: i }, 2000 + i);
    expect(ring.x).toHaveLength(MAX_MARKERS);
    const live = Array.from({ length: MAX_MARKERS }, (_, i) => ring.age(i, 2100)).filter((a) => a >= 0);
    expect(live).toHaveLength(MAX_MARKERS);
    const a = markerLook(0);
    const b = markerLook(0.9);
    expect(a.alpha).toBe(1);
    expect(b.alpha).toBeLessThan(0.3);
    expect(b.scale).toBeLessThan(a.scale);
  });
});
