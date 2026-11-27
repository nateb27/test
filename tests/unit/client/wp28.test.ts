import type { Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { registry } from '../../../src/data';
import {
  anySelectedCanTarget,
  createAttackMoveMode,
  createRepairMode,
  cursorCss,
  REPAIR_HINT,
  resolveAttackMoveCommands,
  resolveCursor,
  type AttackMoveDeps,
  type RepairDeps,
} from '../../../src/client/input/placement';
import { makeBuilding, makeUnit } from '../../../src/client/render/dev/fixtureState';
import {
  buildingBarCentres,
  healthBarColor,
  healthBarFill,
  healthBarShown,
  healthBarSize,
  HP_GREEN,
  HP_RED,
  HP_YELLOW,
  markerForCommand,
  MaxHpCache,
} from '../../../src/client/render/overlays';
import { animationPad } from '../../../src/client/render/overlays/unitTop';
import { MAX_PINGS, PING_CYCLE_TICKS, PING_LIFE_TICKS, PingSet, pingLook } from '../../../src/client/ui/minimap';
import type { CommandInput, Entity, EntityId, ReadonlyEntity } from '../../../src/sim/types';

const ME = 1;
const FOE = 2;

describe('health bar rules', () => {
  it('shows for selected entities and damaged ones only', () => {
    expect(healthBarShown(50, 50, false)).toBe(false);
    expect(healthBarShown(50, 50, true)).toBe(true);
    expect(healthBarShown(49, 50, false)).toBe(true);
    expect(healthBarShown(0, 50, true)).toBe(false);
    expect(healthBarShown(10, 0, true)).toBe(false);
  });

  it('a foundation shows no bar for its low construction hp, only when it is hit or selected', () => {
    // 120 of 600 granted by construction so far: not damage.
    expect(healthBarShown(120, 600, false, 120)).toBe(false);
    expect(healthBarShown(119, 600, false, 120)).toBe(true);
    expect(healthBarShown(120, 600, true, 120)).toBe(true);
  });

  it('own bars are green from 50%, yellow from 25%, else red; enemies are always red', () => {
    expect(healthBarColor(100, 100, true)).toBe(HP_GREEN);
    expect(healthBarColor(50, 100, true)).toBe(HP_GREEN);
    expect(healthBarColor(49, 100, true)).toBe(HP_YELLOW);
    expect(healthBarColor(25, 100, true)).toBe(HP_YELLOW);
    expect(healthBarColor(24, 100, true)).toBe(HP_RED);
    expect(healthBarColor(100, 100, false)).toBe(HP_RED);
  });

  it('sizes follow the plan: units 30 x 4, buildings 16 * footprint + 16 x 5', () => {
    expect(healthBarSize('unit', 0)).toEqual({ w: 30, h: 4 });
    expect(healthBarSize('building', 2)).toEqual({ w: 48, h: 5 });
    expect(healthBarSize('building', 4)).toEqual({ w: 80, h: 5 });
  });

  it('the fill is whole pixels, at least 1 while alive, and never beyond the bar', () => {
    expect(healthBarFill(1, 1000, 30)).toBe(1);
    expect(healthBarFill(500, 1000, 30)).toBe(15);
    expect(healthBarFill(1000, 1000, 30)).toBe(30);
    expect(healthBarFill(2000, 1000, 30)).toBe(30);
    expect(healthBarFill(0, 1000, 30)).toBe(0);
  });

  it('caches max hp per owner and def and refreshes when the owner researches', () => {
    let calls = 0;
    let bonus = 0;
    const cache = new MaxHpCache((owner, type) => {
      calls++;
      return (type === 'swordsman' ? 100 : 50) + owner + bonus;
    });
    expect(cache.get(1, 'swordsman', 0)).toBe(101);
    expect(cache.get(1, 'swordsman', 0)).toBe(101);
    expect(calls).toBe(1);
    expect(cache.get(2, 'swordsman', 0)).toBe(102);
    bonus = 10;
    expect(cache.get(1, 'swordsman', 0)).toBe(101); // stale until research changes
    expect(cache.get(1, 'swordsman', 1)).toBe(111);
    expect(cache.get(2, 'swordsman', 0)).toBe(102); // other owner untouched
  });
});

describe('building bar stacking', () => {
  it.each([0.5, 1, 2])('keeps fixed screen gaps above the art top at %sx, progress above health', (zoom) => {
    const top = -140;
    const both = buildingBarCentres(0, top, 3, true, 1 / zoom, true);
    const only = buildingBarCentres(0, top, 3, true, 1 / zoom, false);
    expect(only.health).toBeNull();
    expect((top - only.progress) * zoom).toBeCloseTo(6.5, 9);
    expect((top - both.health!) * zoom).toBeCloseTo(5.5, 9);
    expect((both.health! - both.progress) * zoom).toBeCloseTo(8, 9);
  });

  it('without a measured top it estimates from the footprint', () => {
    const r = buildingBarCentres(100, null, 2, true, 1, true);
    expect(r.health).toBe(100 - (28 * 2 + 24));
  });
});

describe('unit art top for the health bar', () => {
  const tex = (firstOpaqueRow: number): Texture => {
    const w = 8;
    const h = 40;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let row = firstOpaqueRow; row < h; row++) data[(row * w + 2) * 4 + 3] = 255;
    return { source: { resource: { getContext: () => ({ getImageData: () => ({ data }) }) }, resolution: 1 }, frame: { x: 0, y: 0, width: w, height: h } } as unknown as Texture;
  };

  it('takes the highest model over the frames, from modelTop when the art gives it', () => {
    expect(animationPad({ frames: [tex(30), tex(30)], frameMs: 100, mirrorX: false, modelTop: [31, 28] })).toBe(28);
  });

  it('scans the textures when there is no modelTop, and is unknown for unreadable ones', () => {
    expect(animationPad({ frames: [tex(12), tex(9)], frameMs: 100, mirrorX: false })).toBe(9);
    const opaque = { source: { resource: {} }, frame: { x: 0, y: 0, width: 4, height: 4 } } as unknown as Texture;
    expect(animationPad({ frames: [opaque], frameMs: 0, mirrorX: false })).toBeNull();
  });
});

describe('order markers for combat commands', () => {
  const enemyUnit = makeUnit(9, FOE, 'swordsman', 20, 22, 0);
  const myBarracks = makeBuilding(8, ME, 'barracks', 10, 12);
  const lookup = (id: EntityId): ReadonlyEntity | undefined => [enemyUnit, myBarracks].find((e) => e.id === id);

  it('attackMove marks the point, attack marks the target, repair marks the building centre', () => {
    expect(markerForCommand({ type: 'attackMove', unitIds: [1], x: 5, y: 6, queue: false }, lookup, registry)).toEqual({ kind: 'attackMove', x: 5, y: 6 });
    expect(markerForCommand({ type: 'attack', unitIds: [1], targetId: 9, queue: false }, lookup, registry)).toEqual({ kind: 'attack', x: 20, y: 22 });
    expect(markerForCommand({ type: 'repair', unitIds: [1], buildingId: 8, queue: false }, lookup, registry)).toEqual({ kind: 'repair', x: 11.5, y: 13.5 });
    expect(markerForCommand({ type: 'attack', unitIds: [1], targetId: 404, queue: false }, lookup, registry)).toBeNull();
  });
});

describe('who can attack what', () => {
  const spear = makeUnit(1, ME, 'spearman', 10, 10, 0);
  const ram = makeUnit(2, ME, 'batteringRam', 11, 10, 0);
  const villager = makeUnit(3, ME, 'villager', 12, 10, 0);
  const foeUnit = makeUnit(4, FOE, 'archer', 30, 30, 0);
  const foeHouse = makeBuilding(5, FOE, 'house', 40, 40);
  const myUnit = makeUnit(6, ME, 'archer', 14, 10, 0);

  it('rams only target buildings; other units target anything of another player', () => {
    expect(anySelectedCanTarget([ram], foeUnit, ME, registry)).toBe(false);
    expect(anySelectedCanTarget([ram], foeHouse, ME, registry)).toBe(true);
    expect(anySelectedCanTarget([spear], foeUnit, ME, registry)).toBe(true);
    expect(anySelectedCanTarget([spear, ram], foeUnit, ME, registry)).toBe(true);
    expect(anySelectedCanTarget([spear], myUnit, ME, registry)).toBe(false);
    expect(anySelectedCanTarget([], foeUnit, ME, registry)).toBe(false);
  });

  it('attack-move on ground goes to every selected own unit with the point and queue flag', () => {
    const cmds = resolveAttackMoveCommands({ selected: [spear, ram, villager, foeUnit], target: null, point: { x: 7, y: 8 }, shift: true, owner: ME, registry });
    expect(cmds).toEqual([{ type: 'attackMove', unitIds: [1, 2, 3], x: 7, y: 8, queue: true }]);
  });

  it('attack-move on an enemy: attack for those who can, attack-move to it for the rest', () => {
    const cmds = resolveAttackMoveCommands({ selected: [ram, spear], target: foeUnit, point: { x: 30, y: 30 }, shift: false, owner: ME, registry });
    expect(cmds).toEqual([
      { type: 'attack', unitIds: [1], targetId: 4, queue: false },
      { type: 'attackMove', unitIds: [2], x: 30, y: 30, queue: false },
    ]);
  });

  it('attack-move on an own entity is just a ground click; enemy buildings are attacked', () => {
    const own = resolveAttackMoveCommands({ selected: [spear], target: myUnit, point: { x: 14, y: 10 }, shift: false, owner: ME, registry });
    expect(own).toEqual([{ type: 'attackMove', unitIds: [1], x: 14, y: 10, queue: false }]);
    const b = resolveAttackMoveCommands({ selected: [ram, spear], target: foeHouse, point: { x: 41, y: 41 }, shift: false, owner: ME, registry });
    expect(b).toEqual([{ type: 'attack', unitIds: [1, 2], targetId: 5, queue: false }]);
  });

  it('issues nothing when no selected own unit can attack', () => {
    expect(resolveAttackMoveCommands({ selected: [foeUnit], target: null, point: { x: 1, y: 1 }, shift: false, owner: ME, registry })).toEqual([]);
  });
});

function world(entities: readonly Entity[]): { byId(id: EntityId): ReadonlyEntity | undefined } {
  return { byId: (id) => entities.find((e) => e.id === id) };
}

describe('attack-move mode', () => {
  const spear = makeUnit(1, ME, 'spearman', 10, 10, 0);
  const foe = makeUnit(2, FOE, 'swordsman', 20, 20, 0);
  const w = world([spear, foe]);

  function setup(pick: EntityId | null): { mode: ReturnType<typeof createAttackMoveMode>; issued: CommandInput[]; exits: number[]; toasts: string[] } {
    const issued: CommandInput[] = [];
    const exits: number[] = [];
    const toasts: string[] = [];
    const deps: AttackMoveDeps = {
      canvasToWorld: (x, y) => ({ x: x / 10, y: y / 10 }),
      pickEntity: () => pick,
      entityById: w.byId,
      selection: () => [1],
      playerId: ME,
      registry,
      mapSize: () => ({ w: 64, h: 64 }),
      commands: { issue: (c) => void issued.push(c) },
      onExit: () => void exits.push(1),
      onInvalid: (t) => void toasts.push(t),
    };
    return { mode: createAttackMoveMode(deps), issued, exits, toasts };
  }

  const noMods = { shift: false, ctrl: false, alt: false };

  it('left click on the ground issues attackMove and ends the mode', () => {
    const { mode, issued, exits } = setup(null);
    expect(mode.onLeftClick?.({ x: 200, y: 300 }, noMods)).toBe(true);
    expect(issued).toEqual([{ type: 'attackMove', unitIds: [1], x: 20, y: 30, queue: false }]);
    expect(exits).toHaveLength(1);
    expect(mode.active).toBe(false);
  });

  it('left click on an enemy issues attack', () => {
    const { mode, issued } = setup(2);
    mode.onLeftClick?.({ x: 5, y: 5 }, noMods);
    expect(issued).toEqual([{ type: 'attack', unitIds: [1], targetId: 2, queue: false }]);
  });

  it('shift queues and keeps the mode active', () => {
    const { mode, issued, exits } = setup(null);
    mode.onLeftClick?.({ x: 100, y: 100 }, { ...noMods, shift: true });
    mode.onLeftClick?.({ x: 110, y: 110 }, { ...noMods, shift: true });
    expect(issued.map((c) => (c.type === 'attackMove' ? c.queue : null))).toEqual([true, true]);
    expect(exits).toHaveLength(0);
    expect(mode.active).toBe(true);
  });

  it('clamps the point into the map', () => {
    const { mode, issued } = setup(null);
    mode.onLeftClick?.({ x: 9000, y: -50 }, noMods);
    expect(issued).toEqual([{ type: 'attackMove', unitIds: [1], x: 63.99, y: 0.01, queue: false }]);
  });

  it('right click and Esc cancel without a command', () => {
    for (const how of ['onRightClick', 'onCancel'] as const) {
      const { mode, issued, exits } = setup(null);
      expect(mode[how]?.({ x: 1, y: 1 }, noMods)).toBe(true);
      expect(issued).toEqual([]);
      expect(exits).toHaveLength(1);
      expect(mode.onLeftClick?.({ x: 1, y: 1 }, noMods)).toBe(false);
    }
  });
});

describe('repair mode', () => {
  const villager = makeUnit(1, ME, 'villager', 10, 10, 0);
  const spear = makeUnit(2, ME, 'spearman', 11, 10, 0);
  const hurt = { ...makeBuilding(3, ME, 'barracks', 14, 14), hp: 100 };
  const fine = makeBuilding(4, ME, 'house', 20, 20);
  const foeHurt = { ...makeBuilding(5, FOE, 'barracks', 30, 30), hp: 10 };
  const unfinished = { ...makeBuilding(6, ME, 'house', 40, 40, 0.3), hp: 5 };
  const w = world([villager, spear, hurt, fine, foeHurt, unfinished]);
  const noMods = { shift: false, ctrl: false, alt: false };

  function setup(pick: EntityId | null, selection: EntityId[] = [1, 2]): { mode: ReturnType<typeof createRepairMode>; issued: CommandInput[]; toasts: string[]; exits: number[] } {
    const issued: CommandInput[] = [];
    const toasts: string[] = [];
    const exits: number[] = [];
    const deps: RepairDeps = {
      pickEntity: () => pick,
      entityById: w.byId,
      selection: () => selection,
      playerId: ME,
      registry,
      maxHp: (e) => (e.kind === 'building' ? registry.building(e.typeId).combat.hp : 0),
      commands: { issue: (c) => void issued.push(c) },
      onExit: () => void exits.push(1),
      onInvalid: (t) => void toasts.push(t),
    };
    return { mode: createRepairMode(deps), issued, toasts, exits };
  }

  it('a damaged own building gets repair from the units that can build it (the spearman cannot)', () => {
    const { mode, issued, exits } = setup(3);
    expect(mode.onLeftClick?.({ x: 1, y: 1 }, noMods)).toBe(true);
    expect(issued).toEqual([{ type: 'repair', unitIds: [1], buildingId: 3, queue: false }]);
    expect(exits).toHaveLength(1);
  });

  it.each([
    ['ground', null],
    ['an undamaged own building', 4],
    ['an enemy building', 5],
    ['an unfinished own building', 6],
    ['an own unit', 2],
  ])('clicking %s toasts the hint and keeps the mode', (_label, pick) => {
    const { mode, issued, toasts, exits } = setup(pick);
    expect(mode.onLeftClick?.({ x: 1, y: 1 }, noMods)).toBe(true);
    expect(issued).toEqual([]);
    expect(toasts).toEqual([REPAIR_HINT]);
    expect(exits).toHaveLength(0);
    expect(mode.active).toBe(true);
  });

  it('shift queues and keeps the mode; without a builder it refuses and ends', () => {
    const a = setup(3);
    a.mode.onLeftClick?.({ x: 1, y: 1 }, { ...noMods, shift: true });
    expect(a.issued).toEqual([{ type: 'repair', unitIds: [1], buildingId: 3, queue: true }]);
    expect(a.mode.active).toBe(true);
    const b = setup(3, [2]);
    b.mode.onLeftClick?.({ x: 1, y: 1 }, noMods);
    expect(b.issued).toEqual([]);
    expect(b.toasts).toHaveLength(1);
    expect(b.mode.active).toBe(false);
  });

  it('right click cancels', () => {
    const { mode, exits } = setup(3);
    expect(mode.onRightClick?.({ x: 1, y: 1 }, noMods)).toBe(true);
    expect(exits).toHaveLength(1);
  });
});

describe('cursors', () => {
  const spear = makeUnit(1, ME, 'spearman', 10, 10, 0);
  const foe = makeUnit(2, FOE, 'swordsman', 20, 20, 0);
  const mine = makeUnit(3, ME, 'archer', 12, 10, 0);

  it('target modes win; the sword shows over an attackable enemy only without a mode', () => {
    expect(resolveCursor('attackMove', foe, [spear], ME, registry)).toBe('attackMove');
    expect(resolveCursor('repair', null, [spear], ME, registry)).toBe('repair');
    expect(resolveCursor(null, foe, [spear], ME, registry)).toBe('attack');
    expect(resolveCursor(null, mine, [spear], ME, registry)).toBe('default');
    expect(resolveCursor(null, foe, [], ME, registry)).toBe('default');
    expect(resolveCursor(null, null, [spear], ME, registry)).toBe('default');
    expect(resolveCursor('other', foe, [spear], ME, registry)).toBe('default');
  });

  it('draws data-URI SVG cursors with a fallback, and leaves the default alone', () => {
    expect(cursorCss('default')).toBe('');
    for (const k of ['attack', 'attackMove', 'repair'] as const) {
      const css = cursorCss(k);
      expect(css).toMatch(/^url\("data:image\/svg\+xml,%3Csvg/);
      expect(css).toMatch(/\) \d+ \d+, [a-z]+$/);
    }
  });
});

describe('minimap pings on the match clock', () => {
  it('lives 1.5 s twice, then goes; a load into the past drops it', () => {
    const p = new PingSet();
    p.add(5, 5, 0xff0000, 100);
    p.prune(100 + PING_LIFE_TICKS - 1);
    expect(p.size).toBe(1);
    p.prune(100 + PING_LIFE_TICKS);
    expect(p.size).toBe(0);
    p.add(5, 5, 0xff0000, 100);
    p.prune(40);
    expect(p.size).toBe(0);
  });

  it('keeps at most four, replacing the oldest, and ignores a duplicate of the same alert', () => {
    const p = new PingSet();
    for (let i = 0; i < MAX_PINGS + 2; i++) p.add(i * 10, 0, 0xff0000, i);
    expect(p.size).toBe(MAX_PINGS);
    expect(p.at(0).tick).toBe(2);
    p.add(50, 0.2, 0xff0000, 5);
    expect(p.size).toBe(MAX_PINGS);
    expect(p.at(MAX_PINGS - 1).tick).toBe(5);
  });

  it('the ring expands over each cycle and restarts for the repeat', () => {
    expect(pingLook(0).t).toBe(0);
    expect(pingLook(PING_CYCLE_TICKS / 2).t).toBeCloseTo(0.5, 9);
    expect(pingLook(PING_CYCLE_TICKS).t).toBe(0);
    expect(pingLook(PING_CYCLE_TICKS - 1).alpha).toBeLessThan(pingLook(1).alpha);
    expect(PING_CYCLE_TICKS).toBe(30);
  });
});
