import { describe, expect, it } from 'vitest';
import { registry } from '../../../src/data';
import { classifyTarget, resolveContextCommands, type ContextInput } from '../../../src/client/input/contextual';
import { makeBuilding, makeNode, makeUnit } from '../../../src/client/render/dev/fixtureState';
import type { Entity, ReadonlyEntity } from '../../../src/sim/types';

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
const enemyUnit = makeUnit(17, 2, 'villager', 9.5, 9.25, 0);
const enemyArcher = makeUnit(18, 2, 'archer', 20.5, 3.5, 0);
const enemyDead = { ...makeUnit(19, 2, 'villager', 9, 9, 0), hp: 0 };
const ram = makeUnit(5, ME, 'batteringRam', 9, 5, 0);
const archer = makeUnit(6, ME, 'archer', 10, 5, 0);
const damagedBarracks = { ...makeBuilding(22, ME, 'barracks', 54, 30), hp: 100 };
const damagedMill = { ...makeBuilding(23, ME, 'mill', 58, 30), hp: 1 };
const damagedFarm = { ...makeBuilding(24, ME, 'farm', 62, 30), hp: 1 };
const damagedTc = { ...makeBuilding(25, ME, 'townCenter', 66, 30), hp: 5 };
const damagedUnfinished = { ...makeBuilding(26, ME, 'house', 70, 30, 0.4), hp: 1 };
const tree = makeNode(20, 'tree', 3, 3);
const gold = makeNode(21, 'goldDeposit', 10, 10);

const point = { x: 12.5, y: 13.5 };
const maxHp = (e: ReadonlyEntity): number => (e.kind === 'node' ? 0 : registry.def(e.typeId)!.kind === 'building' ? registry.building(e.typeId).combat.hp : registry.unit(e.typeId).combat.hp);
function resolve(selected: Entity[], target: Entity | null, shift = false, withHp = true) {
  const input: ContextInput = { selected, target, point, shift, owner: ME, registry, ...(withHp ? { maxHp } : {}) };
  return resolveContextCommands(input);
}

describe('classifyTarget', () => {
  it.each([
    [null, 'ground'],
    [villager2, 'unit'],
    [enemyUnit, 'enemyUnit'],
    [enemyDead, 'unit'],
    [tree, 'node'],
    [houseNew, 'ownUnfinishedBuilding'],
    [farm, 'ownFarm'],
    [tc, 'ownDropOff'],
    [millDone, 'ownDropOff'],
    [houseDone, 'otherBuilding'],
    [enemyHouse, 'enemyBuilding'],
    [damagedBarracks, 'ownDamagedBuilding'],
    [damagedTc, 'ownDamagedBuilding'],
    [damagedFarm, 'ownDamagedBuilding'],
    [damagedUnfinished, 'ownUnfinishedBuilding'],
  ] as const)('%#', (target, expected) => {
    expect(classifyTarget(target, ME, registry, maxHp)).toBe(expected);
  });
  it('without a maximum hp nothing is damaged', () => {
    expect(classifyTarget(damagedBarracks, ME, registry)).toBe('otherBuilding');
  });
});

describe('right click with units selected', () => {
  it('ground: move, shift queues', () => {
    expect(resolve([villager, spear], null)).toEqual([{ type: 'move', unitIds: [1, 4], x: 12.5, y: 13.5, queue: false }]);
    expect(resolve([villager], null, true)).toEqual([{ type: 'move', unitIds: [1], x: 12.5, y: 13.5, queue: true }]);
  });
  it('own units and other own buildings: plain move to the clicked point', () => {
    expect(resolve([villager], villager2)).toEqual([{ type: 'move', unitIds: [1], x: 12.5, y: 13.5, queue: false }]);
    expect(resolve([villager], houseDone)).toEqual([{ type: 'move', unitIds: [1], x: 12.5, y: 13.5, queue: false }]);
  });
  it('enemy unit: units that can target it attack, shift queues', () => {
    expect(resolve([villager, spear, archer], enemyUnit)).toEqual([{ type: 'attack', unitIds: [1, 4, 6], targetId: 17, queue: false }]);
    expect(resolve([spear], enemyArcher, true)).toEqual([{ type: 'attack', unitIds: [4], targetId: 18, queue: true }]);
  });
  it('enemy unit: siege cannot target units and walks to the enemy instead', () => {
    expect(resolve([spear, ram], enemyUnit)).toEqual([
      { type: 'attack', unitIds: [4], targetId: 17, queue: false },
      { type: 'move', unitIds: [5], x: 9.5, y: 9.25, queue: false },
    ]);
    expect(resolve([ram], enemyUnit, true)).toEqual([{ type: 'move', unitIds: [5], x: 9.5, y: 9.25, queue: true }]);
  });
  it('enemy building: everyone attacks, siege included', () => {
    expect(resolve([spear, ram, villager], enemyHouse)).toEqual([{ type: 'attack', unitIds: [1, 4, 5], targetId: 16, queue: false }]);
  });
  it('a dead enemy is only ground to walk to', () => {
    expect(resolve([spear], enemyDead)).toEqual([{ type: 'move', unitIds: [4], x: 12.5, y: 13.5, queue: false }]);
  });
  it('own damaged completed building: villagers repair, the rest move to it', () => {
    expect(resolve([villager, villager2, spear], damagedBarracks)).toEqual([
      { type: 'repair', unitIds: [1, 2], buildingId: 22, queue: false },
      { type: 'move', unitIds: [4], x: 55.5, y: 31.5, queue: false },
    ]);
    expect(resolve([villager], damagedBarracks, true)).toEqual([{ type: 'repair', unitIds: [1], buildingId: 22, queue: true }]);
  });
  it('repair wins over the drop-off and farm rules; units that cannot build just move', () => {
    expect(resolve([carrier], damagedTc)).toEqual([{ type: 'repair', unitIds: [3], buildingId: 25, queue: false }]);
    expect(resolve([villager], damagedFarm)).toEqual([{ type: 'repair', unitIds: [1], buildingId: 24, queue: false }]);
    expect(resolve([spear], damagedMill)).toEqual([{ type: 'move', unitIds: [4], x: 59, y: 31, queue: false }]);
  });
  it('a building at full hp keeps the M1 rules; an unfinished one is assisted', () => {
    expect(resolve([villager], barracks)).toEqual([{ type: 'move', unitIds: [1], x: 12.5, y: 13.5, queue: false }]);
    expect(resolve([villager], damagedUnfinished)).toEqual([{ type: 'assist', unitIds: [1], buildingId: 26, queue: false }]);
    expect(resolve([villager], damagedBarracks, false, false)).toEqual([{ type: 'move', unitIds: [1], x: 12.5, y: 13.5, queue: false }]);
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
  it('an enemy or a damaged building under the cursor is only a rally point', () => {
    expect(resolve([tc], enemyHouse)).toEqual([{ type: 'setRally', buildingIds: [10], x: 12.5, y: 13.5 }]);
    expect(resolve([tc], damagedBarracks)).toEqual([{ type: 'setRally', buildingIds: [10], x: 12.5, y: 13.5 }]);
  });
  it('a selected node issues nothing', () => {
    expect(resolve([tree], null)).toEqual([]);
  });
});
