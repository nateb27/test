/**
 * Dev/test fixture: a hand-built GameState with a Town Center, villagers in
 * all facings and states, one of every building, unit and node type, trees,
 * construction stages and a second team. Used by the dev scene page and the
 * renderer tests until the real sim and data are merged.
 */

import type {
  BuildingEntity,
  Entity,
  Facing,
  GameState,
  PlayerState,
  Projectile,
  ProjectileKind,
  ResourceNodeEntity,
  UnitEntity,
} from '../../../sim/types';
import { registry } from '../../../data';
import { emptyStats } from '../../../sim/systems/matchStats';
import { BUILDING_IDS, UNIT_IDS } from '../../art/catalog';

export interface Fixture {
  state: GameState;
  /** Entity ids by role, for tests and screenshots. */
  ids: { townCenter: number; tcRing: number[]; villagers: number[] };
}

/** World-space unit vector for a facing (table in sim/types.ts: 0=+x 1=+x+y 2=+y 3=-x+y 4=-x 5=-x-y 6=-y 7=+x-y). */
function facingVec(f: number): { x: number; y: number } {
  const table: [number, number][] = [
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -1],
  ];
  const [x, y] = table[f]!;
  const len = Math.hypot(x, y);
  return { x: x / len, y: y / len };
}

function player(id: number, civ: string | null, color: number): PlayerState {
  return {
    id,
    civ,
    color,
    resources: { food: 500, wood: 500, gold: 300, stone: 100 },
    age: 1,
    popUsed: 0,
    popCap: 20,
    researched: [],
    cheats: { instantBuild: false, instantResearch: false },
    name: id === 0 ? 'Neutral' : `Player ${id}`,
    controller: id === 0 ? 'neutral' : 'human',
    difficulty: null,
    outcome: 'playing',
    defeatedTick: null,
    stats: emptyStats(),
    alert: null,
  };
}

export type UnitAction = 'idle' | 'walk' | 'work' | 'carry';

export function makeUnit(
  id: number,
  owner: number,
  typeId: string,
  x: number,
  y: number,
  facing: Facing,
  action: UnitAction = 'idle',
): UnitEntity {
  const v = facingVec(facing);
  const moving = action === 'walk' || action === 'carry';
  return {
    id,
    kind: 'unit',
    owner,
    typeId,
    pos: { x, y },
    prevPos: moving ? { x: x - v.x * 0.05, y: y - v.y * 0.05 } : { x, y },
    facing,
    orderQueue: [],
    currentOrder:
      action === 'work'
        ? { type: 'gather', targetId: 0, phase: 'harvesting', resource: 'wood', anchor: { x, y }, dropOffId: null, harvestAccumulator: 0 }
        : null,
    path: null,
    pendingPathRequestId: null,
    carried: action === 'carry' ? { type: 'wood', amount: 8 } : null,
    hp: registry.def(typeId)?.kind === 'unit' ? registry.unit(typeId).combat.hp : 1,
    stance: 'aggressive',
    combat: { cooldown: 0, windup: 0, swingTargetId: null, nextScanTick: 0, lastAttackTick: null },
    lastAttackerId: null,
    lastDamagedTick: null,
  };
}

export function makeBuilding(id: number, owner: number, typeId: string, tx: number, ty: number, progress = 1): BuildingEntity {
  return {
    id,
    kind: 'building',
    owner,
    typeId,
    tile: { tx, ty },
    constructed: progress >= 1,
    progress,
    builderIds: [],
    costPaid: { food: 0, wood: 0, gold: 0, stone: 0 },
    queue: [],
    rally: null,
    incomeAccumulator: 0,
    gathererIds: [],
    hp: registry.def(typeId)?.kind === 'building' ? registry.building(typeId).combat.hp : 1,
    builtHp: registry.def(typeId)?.kind === 'building' ? registry.building(typeId).combat.hp : 1,
    attack: null,
    lastAttackerId: null,
    lastDamagedTick: null,
    repairerIds: [],
    repairAccumulator: 0,
    repairCostAccumulator: { food: 0, wood: 0, gold: 0, stone: 0 },
  };
}

/** A projectile in flight (WP27 fixtures): `ticksLeft` of `flightTicks` remaining, from player 1's entity 1 at entity 2. */
export function makeProjectile(id: number, kind: ProjectileKind, from: { x: number; y: number }, to: { x: number; y: number }, flightTicks: number, ticksLeft: number): Projectile {
  return { id, kind, owner: 1, sourceId: 1, sourceType: kind === 'stone' ? 'trebuchet' : kind === 'fire' ? 'siphonarios' : 'archer', targetId: 2, from: { ...from }, to: { ...to }, flightTicks, ticksLeft, damage: 5 };
}

export function makeNode(id: number, typeId: string, tx: number, ty: number, amount = 100): ResourceNodeEntity {
  return { id, kind: 'node', owner: 0, typeId, tile: { tx, ty }, amount, gathererIds: [] };
}

const UNIT_ACTIONS: UnitAction[] = ['idle', 'walk', 'work', 'carry'];

export function buildFixture(mapSize = 120): Fixture {
  const entities: Entity[] = [];
  let next = 1;
  const nid = (): number => next++;

  // Town Center, 4x4 at the player's start.
  const tcId = nid();
  entities.push(makeBuilding(tcId, 1, 'townCenter', 48, 48));

  // One of every building: row of 2x2s and a row of 3x3s north of the TC.
  const small = BUILDING_IDS.filter((b) => ['house', 'mill', 'lumberCamp', 'miningCamp', 'farm'].includes(b));
  small.forEach((b, i) => entities.push(makeBuilding(nid(), 1, b, 38 + i * 4, 40)));
  const medium = BUILDING_IDS.filter((b) => ['barracks', 'archeryRange', 'stable', 'siegeWorkshop', 'silkWorkshop'].includes(b));
  medium.forEach((b, i) => entities.push(makeBuilding(nid(), 1, b, 36 + i * 5, 33)));

  // Construction stages and an enemy team.
  entities.push(makeBuilding(nid(), 1, 'house', 38, 62, 0.1));
  entities.push(makeBuilding(nid(), 1, 'barracks', 43, 61, 0.6));
  entities.push(makeBuilding(nid(), 1, 'farm', 49, 62, 0.15));
  entities.push(makeBuilding(nid(), 2, 'barracks', 66, 44));
  entities.push(makeBuilding(nid(), 2, 'house', 66, 50));
  entities.push(makeBuilding(nid(), 2, 'stable', 66, 54));

  // Nodes: a grove of trees, berries, gold, stone.
  let seed = 7;
  const rnd = (): number => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed / 4294967296;
  };
  const taken = new Set<string>();
  for (let i = 0; i < 34; i++) {
    const tx = 28 + Math.floor(rnd() * 8);
    const ty = 46 + Math.floor(rnd() * 12);
    const k = `${tx},${ty}`;
    if (taken.has(k)) continue;
    taken.add(k);
    entities.push(makeNode(nid(), 'tree', tx, ty));
  }
  for (const [tx, ty] of [[56, 55], [57, 56], [56, 57], [58, 55]] as const) entities.push(makeNode(nid(), 'berryBush', tx, ty, 150));
  entities.push(makeNode(nid(), 'goldDeposit', 58, 60, 800));
  entities.push(makeNode(nid(), 'stoneDeposit', 61, 60, 600));

  // Villagers: all 8 facings x 4 states, north-west of the TC.
  const villagers: number[] = [];
  UNIT_ACTIONS.forEach((action, row) => {
    for (let f = 0; f < 8; f++) {
      const id = nid();
      villagers.push(id);
      entities.push(makeUnit(id, 1, 'villager', 38 + f * 1.3, 52 + row * 1.6, f as Facing, action));
    }
  });

  // Every unit type for both teams, walking and idle.
  UNIT_IDS.forEach((u, i) => {
    entities.push(makeUnit(nid(), 1, u, 40 + i * 2.2, 68, 0, 'walk'));
    entities.push(makeUnit(nid(), 1, u, 40 + i * 2.2, 71, 1, 'idle'));
    entities.push(makeUnit(nid(), 2, u, 40 + i * 2.2, 74, 6, 'work'));
  });

  // A ring of units around the Town Center (depth-order check).
  const ring: number[] = [];
  const ringPts: [number, number][] = [
    [50, 46.6],
    [46.6, 50],
    [53.4, 50],
    [50, 53.4],
    [47.2, 53.8],
    [53.8, 47.2],
    [53.8, 53.8],
    [46.2, 46.2],
  ];
  ringPts.forEach(([x, y], i) => {
    const id = nid();
    ring.push(id);
    entities.push(makeUnit(id, 1, 'villager', x, y, (i % 8) as Facing, 'idle'));
  });

  entities.sort((a, b) => a.id - b.id);
  const state: GameState = {
    tick: 0,
    seed: 1,
    mapSeed: 1,
    rng: { a: 1, b: 2, c: 3, d: 4 },
    nextEntityId: next,
    occupancyVersion: 0,
    nextPathRequestId: 1,
    map: { width: mapSize, height: mapSize, tiles: new Array<string>(mapSize * mapSize).fill('grass') },
    players: [player(0, null, 0x888888), player(1, 'byzantines', 0x6a2c91), player(2, 'byzantines', 0xc23a2b)],
    entities,
    pathQueue: [],
    objectives: { entries: [] },
    projectiles: [],
    nextProjectileId: 1,
    match: { mode: 'sandbox', winner: null, endedTick: null },
  };
  return { state, ids: { townCenter: tcId, tcRing: ring, villagers } };
}
