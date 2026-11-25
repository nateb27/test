import { describe, expect, it } from 'vitest';
import { registry } from '../../../src/data';
import { classifyTarget, resolveContextCommands, type ContextInput } from '../../../src/client/input/contextual';
import { makeBuilding, makeNode, makeUnit } from '../../../src/client/render/dev/fixtureState';
import type { Entity } from '../../../src/sim/types';

const ME = 1;
const villager = makeUnit(1, ME, 'villager', 5, 5, 0);
const villager2 = makeUnit(2, ME, 'villager', 6, 5, 0);
const carrier = { ...makeUnit(3, ME, 'villager', 7, 5, 0), carried: { type: 'wood' as const, amount: 10 } };
const spear = makeUnit(4, ME, 'spearman', 8, 5, 0);
const tc = makeBuilding(10, ME, 'townCenter', 20, 20);
const millDone = makeBuilding(11, ME, 'mill', 30, 30);
const houseDone = makeBuilding(12, ME, 'house', 34, 30);
const houseNew = makeBuilding(13, ME, 'house', 38, 30, 0.2);
const farm = makeBuilding(14, ME, 'farm', 42, 30);
const barracks = makeBuilding(15, ME, 'barracks', 50, 30);
const enemyHouse = makeBuilding(16, 2, 'house', 60, 60);
const enemyUnit = makeUnit(17, 2, 'villager', 9, 9, 0);
const tree = makeNode(20, 'tree', 3, 3);
const gold = makeNode(21, 'goldDeposit', 10, 10);

const point = { x: 12.5, y: 13.5 };
function resolve(selected: Entity[], target: Entity | null, shift = false) {
  const input: ContextInput = { selected, target, point, shift, owner: ME, registry };
  return resolveContextCommands(input);
}

describe('classifyTarget', () => {
  it.each([
    [null, 'ground'],
    [enemyUnit, 'unit'],
    [tree, 'node'],
    [houseNew, 'ownUnfinishedBuilding'],
    [farm, 'ownFarm'],
    [tc, 'ownDropOff'],
    [millDone, 'ownDropOff'],
    [houseDone, 'otherBuilding'],
    [enemyHouse, 'otherBuilding'],
  ] as const)('%#', (target, expected) => {
    expect(classifyTarget(target, ME, registry)).toBe(expected);
  });
});

describe('right click with units selected', () => {
  it('ground: move, shift queues', () => {
    expect(resolve([villager, spear], null)).toEqual([{ type: 'move', unitIds: [1, 4], x: 12.5, y: 13.5, queue: false }]);
    expect(resolve([villager], null, true)).toEqual([{ type: 'move', unitIds: [1], x: 12.5, y: 13.5, queue: true }]);
  });
  it('enemy unit and other buildings: plain move to the clicked point', () => {
    expect(resolve([villager], enemyUnit)).toEqual([{ type: 'move', unitIds: [1], x: 12.5, y: 13.5, queue: false }]);
    expect(resolve([villager], enemyHouse)).toEqual([{ type: 'move', unitIds: [1], x: 12.5, y: 13.5, queue: false }]);
    expect(resolve([villager], houseDone)).toEqual([{ type: 'move', unitIds: [1], x: 12.5, y: 13.5, queue: false }]);
  });
  it('node: villagers gather, others move to the node centre', () => {
    expect(resolve([villager, villager2], tree, true)).toEqual([{ type: 'gather', unitIds: [1, 2], nodeId: 20, queue: true }]);
    expect(resolve([villager, spear], gold)).toEqual([
      { type: 'gather', unitIds: [1], nodeId: 21, queue: false },
      { type: 'move', unitIds: [4], x: 11, y: 11, queue: false },
    ]);
    expect(resolve([spear], tree)).toEqual([{ type: 'move', unitIds: [4], x: 3.5, y: 3.5, queue: false }]);
  });
  it('own unfinished building: villagers assist', () => {
    expect(resolve([villager, spear], houseNew)).toEqual([
      { type: 'assist', unitIds: [1], buildingId: 13, queue: false },
      { type: 'move', unitIds: [4], x: 39, y: 31, queue: false },
    ]);
  });
  it('own completed farm: villagers work it through a gather command', () => {
    expect(resolve([villager], farm)).toEqual([{ type: 'gather', unitIds: [1], nodeId: 14, queue: false }]);
  });
  it('own drop-off: only villagers carrying an accepted resource drop off', () => {
    expect(resolve([carrier, villager], tc)).toEqual([
      { type: 'dropOff', unitIds: [3], buildingId: 10 },
      { type: 'move', unitIds: [1], x: 22, y: 22, queue: false },
    ]);
    expect(resolve([carrier], millDone)).toEqual([{ type: 'move', unitIds: [3], x: 31, y: 31, queue: false }]); // a mill takes food only
  });
  it('foreign selected units give no orders', () => {
    expect(resolve([enemyUnit], null)).toEqual([]);
  });
  it('units win over buildings in a mixed selection', () => {
    expect(resolve([villager, tc], null)).toEqual([{ type: 'move', unitIds: [1], x: 12.5, y: 13.5, queue: false }]);
  });
});

describe('right click with a building selected', () => {
  it('ground: rally point on the ground', () => {
    expect(resolve([tc], null)).toEqual([{ type: 'setRally', buildingIds: [10], x: 12.5, y: 13.5 }]);
  });
  it('node or farm: rally onto the target', () => {
    expect(resolve([tc, barracks], tree)).toEqual([{ type: 'setRally', buildingIds: [10, 15], x: 3.5, y: 3.5, targetId: 20 }]);
    expect(resolve([tc], farm)).toEqual([{ type: 'setRally', buildingIds: [10], x: 43, y: 31, targetId: 14 }]);
  });
  it('buildings that train nothing, or are unfinished, or are foreign do nothing', () => {
    expect(resolve([houseDone], null)).toEqual([]);
    expect(resolve([makeBuilding(50, ME, 'barracks', 0, 0, 0.5)], null)).toEqual([]);
    expect(resolve([enemyHouse], null)).toEqual([]);
  });
  it('a selected node issues nothing', () => {
    expect(resolve([tree], null)).toEqual([]);
  });
});
