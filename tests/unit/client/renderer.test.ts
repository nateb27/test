import { describe, expect, it } from 'vitest';
import { classifyIcon, classifySprite, DEFAULT_FOOTPRINT } from '../../../src/client/art/catalog';
import { FACING_DIR, FACING_SOURCE } from '../../../src/client/art/units';
import { Camera, MAX_ZOOM, MIN_ZOOM } from '../../../src/client/render/camera';
import {
  buildingStage,
  footprintOf,
  hitBox,
  makeDrawable,
  sortDrawables,
  spriteIdOf,
  unitAnimState,
  type DrawnEntity,
} from '../../../src/client/render/entities';
import { footprintCenter, mapScreenBounds, screenToWorld, worldToScreen } from '../../../src/client/render/iso';
import { pickDrawn } from '../../../src/client/render/picking';
import { grassVariant } from '../../../src/client/render/terrain';
import { registry } from '../../../src/data';
import { buildFixture, makeBuilding, makeNode, makeUnit } from '../../../src/client/render/dev/fixtureState';

// Every id named in plan section 5 (written out independently of the catalogue).
const PLAN_UNITS = ['villager', 'spearman', 'swordsman', 'archer', 'horseman', 'lancer', 'batteringRam', 'trebuchet', 'cataphract', 'siphonarios'];
const PLAN_BUILDINGS = ['townCenter', 'house', 'mill', 'lumberCamp', 'miningCamp', 'farm', 'barracks', 'archeryRange', 'stable', 'siegeWorkshop', 'silkWorkshop'];
const PLAN_NODES = ['tree', 'berryBush', 'goldDeposit', 'stoneDeposit'];
const PLAN_TECHS = ['handCarts', 'ironAxes', 'frameSaws', 'irrigation', 'threeFieldSystem', 'ironPicks', 'timberedShafts', 'guildCharters'];
const PLAN_RESOURCES = ['food', 'wood', 'gold', 'stone'];

describe('projection', () => {
  it('round-trips for many points, including the map corners', () => {
    for (let x = -3; x <= 123; x += 7.3) {
      for (let y = -3; y <= 123; y += 5.9) {
        const s = worldToScreen(x, y);
        const w = screenToWorld(s.x, s.y);
        expect(w.x).toBeCloseTo(x, 9);
        expect(w.y).toBeCloseTo(y, 9);
      }
    }
  });

  it('map bounds enclose all four corners', () => {
    const b = mapScreenBounds(120, 120);
    for (const [x, y] of [[0, 0], [120, 0], [0, 120], [120, 120]] as const) {
      const s = worldToScreen(x, y);
      expect(s.x).toBeGreaterThanOrEqual(b.minX);
      expect(s.x).toBeLessThanOrEqual(b.maxX);
      expect(s.y).toBeGreaterThanOrEqual(b.minY);
      expect(s.y).toBeLessThanOrEqual(b.maxY);
    }
  });
});

describe('depth order around a 4x4 building', () => {
  const tc = makeBuilding(1, 1, 'townCenter', 10, 10); // centre (12, 12)
  const order = (u: { x: number; y: number }, uid = 2): number[] => {
    const unit = makeUnit(uid, 1, 'villager', u.x, u.y, 0);
    return sortDrawables([makeDrawable(registry, tc, 1), makeDrawable(registry, unit, 1)]).map((d) => d.id);
  };

  it('units in front (SE and SW faces) draw after the building', () => {
    for (const p of [{ x: 14.4, y: 12 }, { x: 12, y: 14.4 }, { x: 14.4, y: 14.4 }, { x: 13, y: 14.6 }]) {
      expect(order(p)).toEqual([1, 2]);
    }
  });

  it('units behind (NW and NE faces) draw before the building', () => {
    for (const p of [{ x: 9.6, y: 12 }, { x: 12, y: 9.6 }, { x: 9.6, y: 9.6 }, { x: 11, y: 9.4 }]) {
      expect(order(p)).toEqual([2, 1]);
    }
  });

  it('ties are broken by id', () => {
    const a = makeUnit(5, 1, 'villager', 3, 4, 0);
    const b = makeUnit(3, 1, 'villager', 4, 3, 0);
    expect(sortDrawables([makeDrawable(null, a, 1), makeDrawable(null, b, 1)]).map((d) => d.id)).toEqual([3, 5]);
  });

  it('uses the interpolated position', () => {
    const u = { ...makeUnit(2, 1, 'villager', 10, 10, 0), prevPos: { x: 8, y: 8 } };
    expect(makeDrawable(null, u, 0.5).depth).toBeCloseTo(18);
    expect(makeDrawable(null, u, 0).depth).toBeCloseTo(16);
    expect(makeDrawable(null, u, 1).depth).toBeCloseTo(20);
  });
});

describe('camera', () => {
  const cam = (): Camera => {
    const c = new Camera();
    const b = mapScreenBounds(120, 120);
    c.setBounds({ minX: b.minX, maxX: b.maxX, minY: b.minY, maxY: b.maxY });
    c.setViewport(1280, 720);
    return c;
  };

  it('clamps panning to the map bounds', () => {
    const c = cam();
    c.scrollBy(1e6, 1e6);
    const r = c.visibleRect();
    const b = c.getBounds();
    expect(r.maxX).toBeLessThanOrEqual(b.maxX + 1e-6);
    expect(r.maxY).toBeLessThanOrEqual(b.maxY + 1e-6);
    c.scrollBy(-1e7, -1e7);
    const r2 = c.visibleRect();
    expect(r2.minX).toBeGreaterThanOrEqual(b.minX - 1e-6);
    expect(r2.minY).toBeGreaterThanOrEqual(b.minY - 1e-6);
  });

  it('jumpTo centres on a world position', () => {
    const c = cam();
    c.jumpTo(60, 60);
    const p = c.worldToCanvas(60, 60);
    expect(p.x).toBeCloseTo(640, 6);
    expect(p.y).toBeCloseTo(360, 6);
    c.jumpTo(0, 0); // clamped: the corner cannot be centred
    expect(c.worldToCanvas(0, 0).y).toBeGreaterThanOrEqual(0);
  });

  it('zooms about the cursor and keeps the world point fixed', () => {
    const c = cam();
    c.jumpTo(60, 60);
    for (const [cx, cy] of [[200, 100], [640, 360], [1100, 650]] as const) {
      const before = c.canvasToWorld(cx, cy);
      c.zoomAt(cx, cy, 1.7);
      const after = c.canvasToWorld(cx, cy);
      expect(after.x).toBeCloseTo(before.x, 6);
      expect(after.y).toBeCloseTo(before.y, 6);
      c.zoomAt(cx, cy, 1);
    }
  });

  it('limits zoom to 0.5x-2x', () => {
    const c = cam();
    c.zoomBy(640, 360, 100);
    expect(c.zoom).toBe(MAX_ZOOM);
    c.zoomBy(640, 360, 0.0001);
    expect(c.zoom).toBe(MIN_ZOOM);
  });

  it('canvas <-> world round-trips through the camera', () => {
    const c = cam();
    c.jumpTo(40, 70);
    c.zoomAt(300, 200, 1.4);
    const w = c.canvasToWorld(512, 333);
    const p = c.worldToCanvas(w.x, w.y);
    expect(p.x).toBeCloseTo(512, 6);
    expect(p.y).toBeCloseTo(333, 6);
  });
});

describe('art catalogue', () => {
  it('every plan id resolves to a non-fallback sprite', () => {
    for (const id of PLAN_UNITS) expect(classifySprite(`unit.${id}`), id).toBe('known');
    for (const id of PLAN_BUILDINGS) expect(classifySprite(`building.${id}`), id).toBe('known');
    for (const id of PLAN_NODES) expect(classifySprite(`node.${id}`), id).toBe('known');
  });

  it('every plan id resolves to a non-fallback, non-generic icon', () => {
    for (const id of PLAN_UNITS) expect(classifyIcon(`icon.unit.${id}`), id).toBe('known');
    for (const id of PLAN_BUILDINGS) expect(classifyIcon(`icon.building.${id}`), id).toBe('known');
    for (const id of PLAN_NODES) expect(classifyIcon(`icon.node.${id}`), id).toBe('known');
    for (const id of PLAN_TECHS) expect(classifyIcon(`icon.tech.${id}`), id).toBe('known');
    for (const id of PLAN_RESOURCES) expect(classifyIcon(`icon.resource.${id}`), id).toBe('known');
    for (const n of [1, 2, 3, 4]) expect(classifyIcon(`icon.age.${n}`)).toBe('known');
    expect(classifyIcon('icon.civ.byzantines')).toBe('known');
  });

  it('unknown ids fall back instead of throwing', () => {
    expect(classifySprite('unit.pikeman')).toBe('fallback');
    expect(classifySprite('garbage')).toBe('fallback');
    expect(classifyIcon('icon.unit.pikeman')).toBe('fallback');
    expect(classifyIcon('nonsense')).toBe('fallback');
  });

  it('has a default footprint for every building and node', () => {
    for (const id of [...PLAN_BUILDINGS, ...PLAN_NODES]) expect(DEFAULT_FOOTPRINT[id], id).toBeGreaterThan(0);
    expect(DEFAULT_FOOTPRINT.townCenter).toBe(4);
  });

  it('draws 8 facings from 5 views, mirroring the rest consistently', () => {
    expect(FACING_SOURCE).toHaveLength(8);
    FACING_SOURCE.forEach((s, f) => {
      const d = FACING_DIR[f]!;
      const src = FACING_DIR[s.src]!;
      // A mirrored view must be the horizontal mirror of the facing it stands in for.
      expect(s.mirror ? -src.x : src.x).toBeCloseTo(d.x, 2);
      expect(src.y).toBeCloseTo(d.y, 2);
    });
  });
});

describe('entity helpers', () => {
  it('falls back to catalogue footprints and sprite ids when the def is missing', () => {
    const tc = makeBuilding(1, 1, 'townCenter', 10, 10);
    // With the real content the def wins; with no registry the catalogue answers.
    expect(registry.def('townCenter')).toBeDefined();
    expect(footprintOf(registry, tc)).toBe(4);
    expect(footprintOf(null, tc)).toBe(4);
    expect(spriteIdOf(null, tc)).toBe('building.townCenter');
    const gold = makeNode(2, 'goldDeposit', 5, 5);
    expect(footprintOf(null, gold)).toBe(2);
    // Ids that exist in neither the registry nor the catalogue.
    expect(registry.def('mysteryHall')).toBeUndefined();
    expect(spriteIdOf(registry, makeBuilding(5, 1, 'mysteryHall', 0, 0))).toBe('building.mysteryHall');
    expect(footprintOf(registry, makeBuilding(6, 1, 'barracks', 0, 0))).toBe(3);
    expect(footprintOf(registry, makeBuilding(3, 1, 'mysteryHall', 0, 0))).toBe(2);
    expect(footprintOf(registry, makeNode(4, 'mysteryRock', 0, 0))).toBe(1);
  });

  it('derives animation state and construction stage', () => {
    expect(unitAnimState(makeUnit(1, 1, 'villager', 5, 5, 0, 'idle'))).toBe('idle');
    expect(unitAnimState(makeUnit(1, 1, 'villager', 5, 5, 0, 'walk'))).toBe('walk');
    expect(unitAnimState(makeUnit(1, 1, 'villager', 5, 5, 0, 'carry'))).toBe('carry');
    expect(unitAnimState(makeUnit(1, 1, 'villager', 5, 5, 0, 'work'))).toBe('work');
    expect(buildingStage(makeBuilding(1, 1, 'house', 0, 0, 0.1))).toBe('foundation');
    expect(buildingStage(makeBuilding(1, 1, 'house', 0, 0, 0.6))).toBe('scaffold');
    expect(buildingStage(makeBuilding(1, 1, 'house', 0, 0, 1))).toBe('complete');
  });

  it('grass variants are seeded, stable and use all four looks', () => {
    const seen = new Set<number>();
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) {
      const v = grassVariant(x, y, 99);
      expect(v).toBe(grassVariant(x, y, 99));
      seen.add(v);
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });

  it('the fixture contains every type', () => {
    const { state } = buildFixture();
    const types = new Set(state.entities.map((e) => `${e.kind}.${e.typeId}`));
    for (const id of PLAN_UNITS) expect(types.has(`unit.${id}`), id).toBe(true);
    for (const id of PLAN_BUILDINGS) expect(types.has(`building.${id}`), id).toBe(true);
    for (const id of PLAN_NODES) expect(types.has(`node.${id}`), id).toBe(true);
    const ids = state.entities.map((e) => e.id);
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);
  });
});

describe('picking', () => {
  const rect = (x: number, y: number, w: number, h: number) => ({ minX: x, minY: y, maxX: x + w, maxY: y + h });
  const mk = (id: number, kind: DrawnEntity['kind'], depth: number, hit: ReturnType<typeof rect>, size = 0): DrawnEntity => ({
    id, kind, depth, wx: 0, wy: 0, size, hit, bounds: hit, owner: 1,
  });

  it('prefers units over buildings over nodes, then the front-most', () => {
    const drawn = [
      mk(1, 'node', 1, rect(0, 0, 100, 100)),
      mk(2, 'building', 2, rect(0, 0, 100, 100)),
      mk(3, 'building', 3, rect(0, 0, 100, 100)),
      mk(4, 'unit', 0, rect(40, 40, 10, 10)),
    ];
    expect(pickDrawn(drawn, 45, 45)).toBe(4);
    expect(pickDrawn(drawn, 10, 10)).toBe(3);
    expect(pickDrawn(drawn.slice(0, 2), 10, 10)).toBe(2);
    expect(pickDrawn(drawn.slice(0, 1), 10, 10)).toBe(1);
    expect(pickDrawn(drawn, 500, 500)).toBeNull();
  });

  /** An entity drawn the way the entity layer does it: footprint centre, real hit box. */
  const placed = (id: number, kind: 'building' | 'node', typeId: string, tx: number, ty: number, size: number, w: number, h: number, ay: number): DrawnEntity => {
    const c = footprintCenter(tx, ty, size);
    const s = worldToScreen(c.x, c.y);
    const bounds = { minX: s.x - w / 2, maxX: s.x + w / 2, minY: s.y - ay, maxY: s.y + (h - ay) };
    return { id, kind, depth: c.x + c.y, wx: c.x, wy: c.y, size, bounds, hit: hitBox(kind, typeId, bounds, s, w, h, size), owner: 0 };
  };
  const at = (x: number, y: number) => worldToScreen(x, y);

  it('a ground click next to a tree or deposit is not that entity (footprint first, narrow body)', () => {
    const tree = placed(1, 'node', 'tree', 20, 20, 1, 76, 100, 80);
    const gold = placed(2, 'node', 'goldDeposit', 40, 40, 2, 132, 110, 70);
    const drawn = [tree, gold];
    // On the footprint.
    expect(pickDrawn(drawn, at(20.5, 20.5).x, at(20.5, 20.5).y)).toBe(1);
    expect(pickDrawn(drawn, at(41, 41).x, at(41, 41).y)).toBe(2);
    // The eight neighbouring tiles of the tree, and two tiles away, are ground.
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1], [-1, 1], [1, -1], [2, 0], [0, 2], [2, 2], [-2, 0], [0, -2]] as const) {
      const p = at(20.5 + dx, 20.5 + dy);
      expect(pickDrawn(drawn, p.x, p.y), `tree ${dx},${dy}`).toBeNull();
    }
    for (const [dx, dy] of [[-1.5, 0.5], [2.5, 0.5], [2.5, 2.5], [-1.5, -1.5], [0.5, 2.5], [0.5, -1.5]] as const) {
      const p = at(40 + dx, 40 + dy);
      expect(pickDrawn(drawn, p.x, p.y), `gold ${dx},${dy}`).toBeNull();
    }
    // Several tiles up-screen of a tree is ground, however tall the sprite is.
    const far = at(17.5, 17.5);
    expect(pickDrawn(drawn, far.x, far.y)).toBeNull();
  });

  it('the canopy of a tree and the roof of a building still pick it', () => {
    const tree = placed(1, 'node', 'tree', 20, 20, 1, 76, 100, 80);
    const tc = placed(3, 'building', 'townCenter', 30, 30, 4, 300, 260, 200);
    const c = at(20.5, 20.5);
    expect(pickDrawn([tree], c.x, c.y - 40)).toBe(1);
    const t = at(32, 32);
    expect(pickDrawn([tc], t.x, t.y - 60)).toBe(3);
    // Footprint beats a neighbour's overhanging body: the tile in front of a tree behind it is the tile's own entity.
    const front = placed(4, 'node', 'tree', 21, 21, 1, 76, 100, 80);
    const p = at(20.5, 20.5);
    expect(pickDrawn([tree, front], p.x, p.y)).toBe(1);
  });

  it('footprint centre agrees with the anchor used for buildings', () => {
    const c = footprintCenter(10, 10, 4);
    expect(c).toEqual({ x: 12, y: 12 });
  });
});
