import { describe, expect, it } from 'vitest';
import { registry } from '../../../src/data';
import {
  createPlacementMode,
  createRallyMode,
  describePlacementProblem,
  footprintCentre,
  resolveRallyTarget,
  selectedBuilders,
  snapFootprint,
  type PlacementDeps,
} from '../../../src/client/input/placement';
import { makeBuilding, makeNode, makeUnit } from '../../../src/client/render/dev/fixtureState';
import type { Availability, CommandInput, PlacementResult } from '../../../src/sim/types';

const NO_COST = { food: 0, wood: 0, gold: 0, stone: 0 };
const AVAILABLE: Availability = { available: true, hidden: false, reasons: [], cost: NO_COST, affordable: true, shortfall: NO_COST };

function result(size: number, bad: Set<number> = new Set()): PlacementResult {
  const tiles = Array.from({ length: size * size }, (_, i) => (bad.has(i) ? ('occupied' as const) : null));
  return { ok: bad.size === 0, size, tiles, availability: AVAILABLE };
}

describe('snapFootprint', () => {
  it.each([1, 2, 3, 4])('centres a %ix%i footprint under the cursor', (size) => {
    const origin = { tx: 10, ty: 20 };
    const c = footprintCentre(origin.tx, origin.ty, size);
    // Anywhere strictly within half a tile of the footprint centre snaps to the same origin.
    for (const [dx, dy] of [[0, 0], [0.49, 0.49], [-0.49, -0.49], [0.49, -0.49], [-0.49, 0.49], [0.3, -0.1]] as const) {
      expect(snapFootprint(c.x + dx, c.y + dy, size)).toEqual(origin);
    }
  });

  it('moves one tile at a time as the cursor crosses a snap boundary', () => {
    // 1x1: boundaries are tile edges.
    expect(snapFootprint(3.99, 5.01, 1)).toEqual({ tx: 3, ty: 5 });
    expect(snapFootprint(4.0, 5.99, 1)).toEqual({ tx: 4, ty: 5 });
    // 2x2: boundaries are tile centres (the footprint centre sits on a tile corner).
    expect(snapFootprint(3.49, 5.49, 2)).toEqual({ tx: 2, ty: 4 });
    expect(snapFootprint(3.51, 5.49, 2)).toEqual({ tx: 3, ty: 4 });
    // 3x3: centre is a tile centre.
    expect(snapFootprint(4.5, 6.5, 3)).toEqual({ tx: 3, ty: 5 });
    expect(snapFootprint(4.99, 6.01, 3)).toEqual({ tx: 3, ty: 5 });
  });

  it('footprint centre is the middle of the footprint', () => {
    expect(footprintCentre(3, 5, 1)).toEqual({ x: 3.5, y: 5.5 });
    expect(footprintCentre(3, 5, 4)).toEqual({ x: 5, y: 7 });
  });

  it('can snap outside the map (canPlace reports it)', () => {
    expect(snapFootprint(-0.2, -3, 2)).toEqual({ tx: -1, ty: -4 });
  });
});

describe('describePlacementProblem', () => {
  it('null when ok', () => expect(describePlacementProblem(result(2))).toBeNull());
  it('terrain problems first', () => {
    expect(describePlacementProblem({ ...result(2), ok: false, tiles: ['occupied', 'outOfBounds', null, null] })).toBe('Outside the map');
    expect(describePlacementProblem(result(2, new Set([1])))).toBe('Blocked');
    expect(describePlacementProblem({ ...result(1), ok: false, tiles: ['notBuildable'] })).toBe('Cannot build on this terrain');
  });
  it('then rules, then cost', () => {
    const rule: PlacementResult = { ...result(1), ok: false, availability: { ...AVAILABLE, available: false, reasons: [{ code: 'requiresAge', age: 2 }] } };
    expect(describePlacementProblem(rule)).toBe('Requires age 2');
    const poor: PlacementResult = {
      ...result(1),
      ok: false,
      availability: { ...AVAILABLE, affordable: false, shortfall: { food: 0, wood: 20, gold: 0, stone: 0 } },
    };
    expect(describePlacementProblem(poor)).toBe('Not enough wood');
  });
});

/** A 2x2 building on a flat world where canvas px = world tiles * 10. */
function harness(over: Partial<PlacementDeps> = {}) {
  const issued: CommandInput[] = [];
  const log = { exits: 0, invalid: [] as string[], placed: [] as string[], asked: [] as string[] };
  const blocked = new Set<string>();
  const deps: PlacementDeps = {
    canPlace: (type, tx, ty) => {
      log.asked.push(`${type}@${tx},${ty}`);
      return blocked.has(`${tx},${ty}`) ? result(2, new Set([0])) : result(2);
    },
    canvasToWorld: (x, y) => ({ x: x / 10, y: y / 10 }),
    footprint: () => 2,
    builders: () => [7, 9],
    commands: { issue: (c) => issued.push(c) },
    onExit: () => log.exits++,
    onInvalid: (r) => log.invalid.push(r),
    onPlaced: (tx, ty) => log.placed.push(`${tx},${ty}`),
    ...over,
  };
  return { mode: createPlacementMode('house', deps), issued, log, blocked };
}
const noMods = { shift: false, ctrl: false, alt: false };
const shift = { shift: true, ctrl: false, alt: false };

describe('placement mode state machine', () => {
  it('ghost is hidden until the pointer moves, then follows it snapped with the footprint centred', () => {
    const { mode } = harness();
    expect(mode.ghost.visible).toBe(false);
    mode.onPointerMove?.({ x: 52, y: 83 }, noMods); // world (5.2, 8.3): 2x2 centre snaps to corner (5, 8) -> origin (4, 7)
    expect(mode.ghost).toMatchObject({ visible: true, tx: 4, ty: 7, size: 2, ok: true, reason: null });
    expect(mode.ghost.tileOk).toEqual([true, true, true, true]);
  });

  it('shows per-tile and overall invalid state with a reason', () => {
    const { mode, blocked } = harness();
    blocked.add('4,7');
    mode.onPointerMove?.({ x: 52, y: 83 }, noMods);
    expect(mode.ghost.ok).toBe(false);
    expect(mode.ghost.tileOk).toEqual([false, true, true, true]);
    expect(mode.ghost.reason).toBe('Blocked');
  });

  it('left click on a valid spot issues build for the builders and exits', () => {
    const { mode, issued, log } = harness();
    expect(mode.onLeftClick?.({ x: 52, y: 83 }, noMods)).toBe(true);
    expect(issued).toEqual([{ type: 'build', unitIds: [7, 9], buildingType: 'house', tx: 4, ty: 7, queue: false }]);
    expect(log.exits).toBe(1);
    expect(log.placed).toEqual(['4,7']);
    expect(mode.active).toBe(false);
    // Once finished the mode ignores input.
    expect(mode.onLeftClick?.({ x: 52, y: 83 }, noMods)).toBe(false);
    expect(issued).toHaveLength(1);
  });

  it('shift click repeats: stays active and queues', () => {
    const { mode, issued, log } = harness();
    mode.onLeftClick?.({ x: 52, y: 83 }, shift);
    mode.onLeftClick?.({ x: 92, y: 83 }, shift);
    expect(mode.active).toBe(true);
    expect(log.exits).toBe(0);
    expect(issued).toEqual([
      { type: 'build', unitIds: [7, 9], buildingType: 'house', tx: 4, ty: 7, queue: true },
      { type: 'build', unitIds: [7, 9], buildingType: 'house', tx: 8, ty: 7, queue: true },
    ]);
    // A final click without shift places and ends.
    mode.onLeftClick?.({ x: 132, y: 83 }, noMods);
    expect(issued).toHaveLength(3);
    expect(issued[2]).toMatchObject({ queue: false });
    expect(mode.active).toBe(false);
  });

  it('an invalid click is consumed, issues nothing and keeps the mode', () => {
    const { mode, issued, log, blocked } = harness();
    blocked.add('4,7');
    expect(mode.onLeftClick?.({ x: 52, y: 83 }, noMods)).toBe(true);
    expect(issued).toEqual([]);
    expect(log.invalid).toEqual(['Blocked']);
    expect(mode.active).toBe(true);
  });

  it('no builders: a click is refused with a message', () => {
    const { mode, issued, log } = harness({ builders: () => [] });
    mode.onLeftClick?.({ x: 52, y: 83 }, noMods);
    expect(issued).toEqual([]);
    expect(log.invalid).toEqual(['Select a villager to build']);
    expect(mode.active).toBe(true);
  });

  it('right click and Esc cancel without issuing', () => {
    const a = harness();
    expect(a.mode.onRightClick?.({ x: 1, y: 1 }, noMods)).toBe(true);
    expect(a.mode.active).toBe(false);
    expect(a.log.exits).toBe(1);
    expect(a.issued).toEqual([]);
    const b = harness();
    expect(b.mode.onCancel?.()).toBe(true);
    expect(b.mode.active).toBe(false);
    expect(b.mode.onCancel?.()).toBe(false); // nothing left to cancel: Esc falls through to the menu
  });

  it('hides the ghost when the pointer leaves the canvas', () => {
    const { mode } = harness({ viewport: () => ({ w: 100, h: 100 }) });
    mode.onPointerMove?.({ x: 50, y: 50 }, noMods);
    expect(mode.ghost.visible).toBe(true);
    mode.onPointerMove?.({ x: 150, y: 50 }, noMods);
    expect(mode.ghost.visible).toBe(false);
  });
});

describe('selectedBuilders', () => {
  const villager = makeUnit(1, 1, 'villager', 5, 5, 0);
  const spear = makeUnit(2, 1, 'spearman', 6, 5, 0);
  const enemyVillager = makeUnit(3, 2, 'villager', 7, 5, 0);
  const all = [villager, spear, enemyVillager];
  const byId = (id: number) => all.find((e) => e.id === id);
  it('keeps own units whose def can build the type', () => {
    expect(selectedBuilders([3, 2, 1], byId, 1, 'house', registry)).toEqual([1]);
    expect(selectedBuilders([2], byId, 1, 'house', registry)).toEqual([]);
  });
});

describe('rally', () => {
  const tree = makeNode(20, 'tree', 3, 3);
  const house = makeBuilding(21, 1, 'house', 30, 30);
  const unit = makeUnit(22, 2, 'villager', 9, 9, 0);

  it('ground click: ground rally at the clamped point', () => {
    expect(resolveRallyTarget({ x: 12.5, y: 13.5 }, null, registry, 120, 120)).toEqual({ x: 12.5, y: 13.5 });
    expect(resolveRallyTarget({ x: -4, y: 500 }, null, registry, 120, 120)).toEqual({ x: 0.01, y: 119.99 });
  });
  it('node and building: entity rally onto its footprint centre', () => {
    expect(resolveRallyTarget({ x: 3.2, y: 3.4 }, tree, registry, 120, 120)).toEqual({ x: 3.5, y: 3.5, targetId: 20 });
    expect(resolveRallyTarget({ x: 31, y: 31 }, house, registry, 120, 120)).toEqual({ x: 31, y: 31, targetId: 21 });
  });
  it('a unit under the cursor is only a ground point', () => {
    expect(resolveRallyTarget({ x: 9.1, y: 9.2 }, unit, registry, 120, 120)).toEqual({ x: 9.1, y: 9.2 });
  });

  function rally(selection: number[], picked: number | null) {
    const tc = makeBuilding(10, 1, 'townCenter', 20, 20);
    const barracks = makeBuilding(11, 1, 'barracks', 40, 40);
    const enemyBarracks = makeBuilding(12, 2, 'barracks', 60, 60);
    const all = [tc, barracks, enemyBarracks, tree, house, unit];
    const issued: CommandInput[] = [];
    let exits = 0;
    const mode = createRallyMode({
      canvasToWorld: (x, y) => ({ x: x / 10, y: y / 10 }),
      pickEntity: () => picked,
      entityById: (id) => all.find((e) => e.id === id),
      selection: () => selection,
      playerId: 1,
      registry,
      mapSize: () => ({ w: 120, h: 120 }),
      commands: { issue: (c) => issued.push(c) },
      onExit: () => exits++,
    });
    return { mode, issued, exits: () => exits };
  }

  it('click issues setRally for the selected producing buildings only, then exits', () => {
    const r = rally([21, 12, 11, 10], null);
    expect(r.mode.onLeftClick?.({ x: 125, y: 135 }, noMods)).toBe(true);
    expect(r.issued).toEqual([{ type: 'setRally', buildingIds: [10, 11], x: 12.5, y: 13.5 }]);
    expect(r.exits()).toBe(1);
    expect(r.mode.active).toBe(false);
  });
  it('click on a node rallies onto it', () => {
    const r = rally([10], 20);
    r.mode.onLeftClick?.({ x: 35, y: 35 }, noMods);
    expect(r.issued).toEqual([{ type: 'setRally', buildingIds: [10], x: 3.5, y: 3.5, targetId: 20 }]);
  });
  it('no producing building selected: nothing issued', () => {
    const r = rally([21], null);
    r.mode.onLeftClick?.({ x: 35, y: 35 }, noMods);
    expect(r.issued).toEqual([]);
    expect(r.mode.active).toBe(false);
  });
  it('right click and Esc cancel', () => {
    const a = rally([10], null);
    expect(a.mode.onRightClick?.({ x: 0, y: 0 }, noMods)).toBe(true);
    expect(a.issued).toEqual([]);
    const b = rally([10], null);
    expect(b.mode.onCancel?.()).toBe(true);
    expect(b.mode.onCancel?.()).toBe(false);
  });
});
