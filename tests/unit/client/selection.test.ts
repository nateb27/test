import { describe, expect, it } from 'vitest';
import { registry } from '../../../src/data';
import { resolveHotkey, HOTKEYS } from '../../../src/client/input/hotkeys';
import {
  boxSelection,
  clickSelection,
  ControlGroups,
  findTownCenter,
  isIdleVillager,
  isWorker,
  nextIdleVillager,
  pruneIds,
  sameTypeSelection,
  SelectionStore,
  trackClick,
  type EntityLookup,
} from '../../../src/client/input/selection';
import { makeBuilding, makeNode, makeUnit } from '../../../src/client/render/dev/fixtureState';
import type { Entity, ReadonlyEntity } from '../../../src/sim/types';

const ME = 1;
const ENEMY = 2;

const v1 = makeUnit(10, ME, 'villager', 5, 5, 0);
const v2 = makeUnit(11, ME, 'villager', 6, 5, 0);
const v3 = makeUnit(12, ME, 'villager', 7, 5, 0);
const sp = makeUnit(13, ME, 'spearman', 8, 5, 0);
const foe = makeUnit(14, ENEMY, 'villager', 9, 5, 0);
const tc = makeBuilding(20, ME, 'townCenter', 20, 20);
const house = makeBuilding(21, ME, 'house', 30, 30);
const tree = makeNode(30, 'tree', 3, 3);
const all: Entity[] = [v1, v2, v3, sp, foe, tc, house, tree];
const get: EntityLookup = (id) => all.find((e) => e.id === id);

describe('click selection', () => {
  it('selects the clicked own entity', () => {
    expect(clickSelection([], v1, false, ME, get)).toEqual([10]);
    expect(clickSelection([11], v1, false, ME, get)).toEqual([10]);
  });
  it('clears on empty ground, shift keeps', () => {
    expect(clickSelection([10], null, false, ME, get)).toEqual([]);
    expect(clickSelection([10], null, true, ME, get)).toEqual([10]);
  });
  it('shift adds and removes own entities', () => {
    expect(clickSelection([10], v2, true, ME, get)).toEqual([10, 11]);
    expect(clickSelection([10, 11], v1, true, ME, get)).toEqual([11]);
    expect(clickSelection([10], tc, true, ME, get)).toEqual([10, 20]);
  });
  it('foreign entities and nodes are selected alone and never mixed in', () => {
    expect(clickSelection([10], foe, false, ME, get)).toEqual([14]);
    expect(clickSelection([10], tree, false, ME, get)).toEqual([30]);
    expect(clickSelection([10], foe, true, ME, get)).toEqual([10]);
    expect(clickSelection([30], v1, true, ME, get)).toEqual([10]);
  });
});

describe('box selection', () => {
  it('selects only own units from the box', () => {
    expect(boxSelection([], [10, 11, 14, 20, 30], false, ME, get)).toEqual([10, 11]);
  });
  it('an empty box clears, shift keeps', () => {
    expect(boxSelection([10], [20, 30], false, ME, get)).toEqual([]);
    expect(boxSelection([10], [20, 30], true, ME, get)).toEqual([10]);
  });
  it('shift adds without duplicates and keeps ids ascending', () => {
    expect(boxSelection([12, 10], [10, 11], true, ME, get)).toEqual([10, 11, 12]);
  });
  it('replaces a foreign selection even with shift', () => {
    expect(boxSelection([30], [10], true, ME, get)).toEqual([10]);
  });
  it('soldiers first: a box with soldiers leaves the villagers out; villagers alone are still boxed', () => {
    const worker = (e: ReadonlyEntity): boolean => isWorker(e, registry);
    expect(boxSelection([], [10, 11, 13, 14], false, ME, get, worker)).toEqual([13]);
    expect(boxSelection([], [10, 11, 14], false, ME, get, worker)).toEqual([10, 11]);
    // Shift keeps what was selected (villagers too) and adds only the boxed soldiers.
    expect(boxSelection([12], [10, 13], true, ME, get, worker)).toEqual([12, 13]);
  });
});

describe('double-click selects all visible of the type', () => {
  it('units of the same type only', () => {
    expect(sameTypeSelection(v1, [v1, v2, v3, sp, foe], [10], false, ME, get)).toEqual([10, 11, 12]);
  });
  it('buildings of the same type, not other kinds', () => {
    const house2 = makeBuilding(22, ME, 'house', 34, 30);
    expect(sameTypeSelection(house, [house, house2, tc, v1], [], false, ME, get)).toEqual([21, 22]);
  });
  it('shift adds to the existing selection', () => {
    expect(sameTypeSelection(sp, [sp], [10], true, ME, get)).toEqual([10, 13]);
  });
  it('a foreign entity selects only itself', () => {
    expect(sameTypeSelection(foe, [foe, v1], [], false, ME, get)).toEqual([14]);
  });
});

describe('control groups', () => {
  const alive = new Set([10, 11, 12]);
  const exists = (id: number): boolean => alive.has(id);
  it('assigns and recalls', () => {
    const g = new ControlGroups();
    g.assign(1, [12, 10]);
    expect(g.recall(1, exists)).toEqual([10, 12]);
    expect(g.recall(2, exists)).toEqual([]);
  });
  it('ignores an empty assignment', () => {
    const g = new ControlGroups();
    g.assign(3, [10]);
    g.assign(3, []);
    expect(g.get(3)).toEqual([10]);
  });
  it('drops dead entities on recall and forgets an empty group', () => {
    const g = new ControlGroups();
    g.assign(1, [10, 99]);
    expect(g.recall(1, exists)).toEqual([10]);
    g.assign(2, [98]);
    expect(g.recall(2, exists)).toEqual([]);
    expect(g.get(2)).toEqual([]);
  });
  it('reassigning replaces', () => {
    const g = new ControlGroups();
    g.assign(1, [10, 11]);
    g.assign(1, [12]);
    expect(g.get(1)).toEqual([12]);
  });
});

describe('SelectionStore and pruning', () => {
  it('notifies only on change and sorts ids', () => {
    const s = new SelectionStore();
    const seen: number[][] = [];
    const off = s.subscribe((ids) => seen.push([...ids]));
    s.set([11, 10]);
    s.set([10, 11]);
    s.set([10]);
    off();
    s.set([]);
    expect(seen).toEqual([[10, 11], [10]]);
  });
  it('prunes entities that disappeared, selection and groups', () => {
    const s = new SelectionStore();
    s.set([10, 11, 12]);
    s.groups.assign(1, [10, 11]);
    const seen: number[][] = [];
    s.subscribe((ids) => seen.push([...ids]));
    s.prune((id) => id !== 11);
    expect(s.ids).toEqual([10, 12]);
    expect(s.groups.get(1)).toEqual([10]);
    expect(seen).toEqual([[10, 12]]);
    s.prune((id) => id !== 11); // nothing changes, no notification
    expect(seen.length).toBe(1);
  });
  it('pruneIds returns the same array when all exist', () => {
    const ids = [1, 2];
    expect(pruneIds(ids, () => true)).toBe(ids);
  });
});

describe('town center and idle villagers', () => {
  it('finds the own completed Town Center', () => {
    const unfinished = makeBuilding(5, ME, 'townCenter', 0, 0, 0.5);
    expect(findTownCenter([unfinished, makeBuilding(6, ENEMY, 'townCenter', 0, 0), tc], ME, registry)?.id).toBe(20);
    expect(findTownCenter([house], ME, registry)).toBeNull();
  });
  it('idle means no order, queue or path; military units never count', () => {
    const busy = makeUnit(40, ME, 'villager', 1, 1, 0, 'work');
    expect(isIdleVillager(v1, ME, registry)).toBe(true);
    expect(isIdleVillager(busy, ME, registry)).toBe(false);
    expect(isIdleVillager(sp, ME, registry)).toBe(false);
    expect(isIdleVillager(foe, ME, registry)).toBe(false);
  });
  it('cycles through idle villagers in id order and wraps', () => {
    const busy = makeUnit(11, ME, 'villager', 1, 1, 0, 'work');
    const list = [v1, busy, v3, sp, tc];
    expect(nextIdleVillager(list, ME, null, registry)).toBe(10);
    expect(nextIdleVillager(list, ME, 10, registry)).toBe(12);
    expect(nextIdleVillager(list, ME, 12, registry)).toBe(10);
    expect(nextIdleVillager([tc], ME, null, registry)).toBeNull();
  });
});

describe('hotkey table', () => {
  const press = (code: string, mods: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }> = {}) =>
    resolveHotkey(HOTKEYS, { code, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });

  it('maps the command card grid QWERT / ASDFG / ZXCVB to slots 0..14', () => {
    const rows = ['QWERT', 'ASDFG', 'ZXCVB'];
    rows.forEach((row, r) =>
      [...row].forEach((letter, c) => expect(press(`Key${letter}`)).toEqual({ type: 'cardSlot', slot: r * 5 + c })),
    );
  });
  it('WASD letters are card slots, not camera keys', () => {
    expect(press('KeyW')).toEqual({ type: 'cardSlot', slot: 1 });
  });
  it('digits recall, ctrl+digits assign', () => {
    expect(press('Digit3')).toEqual({ type: 'recallGroup', group: 3 });
    expect(press('Digit3', { ctrlKey: true })).toEqual({ type: 'assignGroup', group: 3 });
    expect(press('Digit3', { metaKey: true })).toEqual({ type: 'assignGroup', group: 3 });
    expect(press('Digit0')).toBeNull();
  });
  it('binds the plan 7.1 keys', () => {
    expect(press('KeyH')).toEqual({ type: 'selectTownCenter' });
    expect(press('Period')).toEqual({ type: 'cycleIdleVillager' });
    expect(press('Delete')).toEqual({ type: 'deleteSelection' });
    expect(press('Escape')).toEqual({ type: 'cancel' });
    expect(press('F10')).toEqual({ type: 'togglePause' });
    expect(press('Pause')).toEqual({ type: 'togglePause' });
    expect(press('F3')).toEqual({ type: 'toggleDebug' });
  });
  it('ctrl+letter and alt combinations are not hotkeys', () => {
    expect(press('KeyH', { ctrlKey: true })).toBeNull();
    expect(press('KeyH', { altKey: true })).toBeNull();
  });
  it('has no duplicate bindings', () => {
    const keys = HOTKEYS.map((b) => `${b.code}|${b.ctrl ?? false}|${b.shift ?? '*'}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('double-click tracking', () => {
  it('two plain clicks on the same entity within the window are a double', () => {
    const a = trackClick(null, 10, false, 1000);
    expect(a.isDouble).toBe(false);
    expect(trackClick(a.next, 10, false, 1100).isDouble).toBe(true);
    expect(trackClick(a.next, 11, false, 1100).isDouble).toBe(false);
    expect(trackClick(a.next, 10, false, 1500).isDouble).toBe(false);
  });
  it('click then shift-click shortly after is not a double and resets the tracker', () => {
    const a = trackClick(null, 10, false, 1000);
    const b = trackClick(a.next, 10, true, 1010);
    expect(b.isDouble).toBe(false);
    expect(b.next).toBeNull();
    // the following plain click starts a fresh sequence, only the next one is a double
    const c = trackClick(b.next, 10, false, 1020);
    expect(c.isDouble).toBe(false);
    expect(trackClick(c.next, 10, false, 1030).isDouble).toBe(true);
  });
  it('shift-click then plain click is not a double', () => {
    const a = trackClick(null, 10, true, 1000);
    expect(trackClick(a.next, 10, false, 1010).isDouble).toBe(false);
  });
});
