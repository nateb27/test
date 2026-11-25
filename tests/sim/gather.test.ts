import { describe, expect, it } from 'vitest';
import { applyGatherCommand } from '../../src/sim/systems/orders/gather';
import { createNode } from '../../src/sim/entities';
import { hashState } from '../../src/sim/hash';
import { deserialize, serialize } from '../../src/sim/serialize';
import { simFromState } from '../../src/sim/sim';
import { GATHER_RETARGET_RADIUS, type Command, type GatherCommand, type GatherOrderState, type Sim } from '../../src/sim/types';
import {
  building,
  dropOffCmd,
  gatherCmd,
  GATHERER,
  idleEvents,
  makeData,
  makeWorld,
  moveCmd,
  nodeOf,
  PLAN_RATES,
  refreshOccupancy,
  rejections,
  run,
  runUntil,
  SOLDIER,
  tick,
  tree,
  unitOf,
  villager,
  type World,
} from './gatherHelpers';

function order(w: World, unitId: number): GatherOrderState {
  const o = unitOf(w, unitId).currentOrder;
  if (o === null || o.type !== 'gather') throw new Error('unit has no gather order');
  return o;
}

/** A town centre at (2,2) plus a villager next to it. */
function townWorld(extra: (state: World['state']) => void = () => {}, data = makeData()): World {
  return makeWorld((s) => {
    building(s, 'townCenter', 2, 2);
    extra(s);
  }, data);
}

describe('gather command validation', () => {
  it('rejects a unit that cannot gather and leaves it without orders', () => {
    const w = townWorld((s) => {
      villager(s, 7.5, 3.5, 1, SOLDIER);
      tree(s, 12, 3);
    });
    tick(w, [gatherCmd(1, [2], 3)]);
    expect(rejections(w)).toEqual(['cannotPerform']);
    expect(unitOf(w, 2).currentOrder).toBeNull();
    expect(unitOf(w, 2).orderQueue).toEqual([]);
  });

  it('rejects unknown, foreign, non-unit units and bad targets with the right reasons', () => {
    const w = townWorld((s) => {
      villager(s, 7.5, 3.5); // 2
      villager(s, 8.5, 3.5, 2); // 3 (enemy)
      tree(s, 12, 3); // 4
      building(s, 'house', 20, 20); // 5
      building(s, 'farm', 24, 20, false); // 6 unfinished farm
      building(s, 'farm', 28, 20, true, 2); // 7 enemy farm
    });
    const cases: [Command, string][] = [
      [gatherCmd(1, [99], 4), 'unknownEntity'],
      [gatherCmd(1, [3], 4), 'notOwner'],
      [gatherCmd(1, [1], 4), 'cannotPerform'], // a building is not a unit
      [gatherCmd(1, [2], 99), 'unknownEntity'],
      [gatherCmd(1, [2], 3), 'invalidTarget'], // a unit
      [gatherCmd(1, [2], 5), 'invalidTarget'], // a house is not a farm
      [gatherCmd(1, [2], 6), 'notConstructed'],
      [gatherCmd(1, [2], 7), 'notOwner'],
    ];
    for (const [cmd, reason] of cases) {
      w.events = [];
      tick(w, [cmd]);
      expect(rejections(w), reason).toEqual([reason]);
    }
    expect(unitOf(w, 2).orderQueue).toEqual([]);
    expect(unitOf(w, 2).currentOrder).toBeNull();
  });

  it('is all or nothing: one soldier in the group rejects everybody', () => {
    const w = townWorld((s) => {
      villager(s, 7.5, 3.5);
      villager(s, 7.5, 4.5, 1, SOLDIER);
      tree(s, 12, 3);
    });
    tick(w, [gatherCmd(1, [2, 3], 4)]);
    expect(rejections(w)).toEqual(['cannotPerform']);
    expect(unitOf(w, 2).currentOrder).toBeNull();
  });

  it('rejects an already empty node and a unit that lacks that gather kind', () => {
    const data = makeData({ wood: 5 }); // cannot mine
    const w = townWorld((s) => {
      villager(s, 7.5, 3.5);
      createNode(s, 'goldDeposit', 20, 20, 800);
      tree(s, 12, 3, 0);
    }, data);
    tick(w, [gatherCmd(1, [2], 3)]);
    expect(rejections(w)).toEqual(['cannotPerform']);
    // a node at 0 is only removed in cleanup, so the handler sees it within the tick
    w.ctx.events = [];
    applyGatherCommand(w.ctx, gatherCmd(1, [2], 4) as GatherCommand);
    expect(w.ctx.events.map((e) => e.type === 'CommandRejected' && e.reason)).toEqual(['unknownEntity']);
    const empty = createNode(w.state, 'tree', 30, 30, 0);
    w.ctx.events = [];
    applyGatherCommand(w.ctx, gatherCmd(1, [2], empty.id) as GatherCommand);
    expect(w.ctx.events.map((e) => e.type === 'CommandRejected' && e.reason)).toEqual(['invalidTarget']);
  });
});

describe('the gather loop', () => {
  it('moves resources exactly over many trips: nothing lost, nothing created', () => {
    const w = townWorld((s) => {
      villager(s, 6.5, 3.5); // 2, beside the town centre
      tree(s, 12, 3, 1000); // 3
    });
    const v = unitOf(w, 2);
    const t = nodeOf(w, 3)!;
    const player = w.state.players[1]!;
    tick(w, [gatherCmd(1, [2], 3)]);
    const deposits: number[] = [];
    let last = 0;
    for (let i = 0; i < 4000 && player.resources.wood < 80; i++) {
      tick(w);
      // conservation: what left the tree is in the bank or in the villager's hands
      expect(player.resources.wood + (v.carried?.amount ?? 0)).toBe(1000 - t.amount);
      expect(v.carried?.amount ?? 0).toBeLessThanOrEqual(10);
      if (player.resources.wood !== last) {
        deposits.push(player.resources.wood - last);
        last = player.resources.wood;
      }
    }
    expect(player.resources.wood).toBe(80);
    expect(deposits).toEqual([10, 10, 10, 10, 10, 10, 10, 10]);
    expect(player.resources.food + player.resources.gold + player.resources.stone).toBe(0);
    expect(t.gathererIds).toEqual([2]);
  });

  it('harvests a full load in exactly capacity / rate ticks (integer carry plus accumulator)', () => {
    const w = townWorld((s) => {
      villager(s, 11.5, 3.5); // adjacent to the tree at (12,3)
      tree(s, 12, 3, 1000);
    });
    const v = unitOf(w, 2);
    tick(w, [gatherCmd(1, [2], 3)]); // order begins, phase start
    tick(w); // start -> toNode
    tick(w); // adjacent -> harvesting
    const amounts: number[] = [];
    for (let i = 0; i < 40; i++) {
      tick(w);
      amounts.push(v.carried?.amount ?? 0);
    }
    // 5 wood/s = 0.25 per tick: one unit every 4th tick, a full 10 after 40 ticks
    expect(amounts.slice(0, 8)).toEqual([0, 0, 1, 1, 1, 1, 2, 2]);
    expect(amounts[38]).toBe(10);
    expect(amounts[37]).toBe(9);
    expect(order(w, 2).phase).toBe('toDropOff');
  });

  it('keeps fractional progress in the accumulator across trips with the plan rate', () => {
    const w = townWorld(
      (s) => {
        villager(s, 11.5, 3.5);
        tree(s, 12, 3, 1000);
      },
      makeData(PLAN_RATES),
    );
    tick(w, [gatherCmd(1, [2], 3)]);
    run(w, 3000);
    const harvested = 1000 - nodeOf(w, 3)!.amount;
    const banked = w.state.players[1]!.resources.wood + (unitOf(w, 2).carried?.amount ?? 0);
    expect(banked).toBe(harvested);
    // 3000 ticks = 150 s at 0.4/s = 60 wood at most, minus walking time
    expect(harvested).toBeGreaterThan(40);
    expect(harvested).toBeLessThanOrEqual(60);
  });

  it('reads gather rate and capacity from the resolved stat cache when it has them', () => {
    const w = townWorld((s) => {
      villager(s, 11.5, 3.5);
      tree(s, 12, 3, 1000);
    });
    w.ctx.runtime.resolvedStats[1] = { [GATHERER]: { carryCapacity: 15, 'gatherRate.wood': 10 } };
    const v = unitOf(w, 2);
    tick(w, [gatherCmd(1, [2], 3)]);
    run(w, 2);
    run(w, 29); // 0.5 per tick: 15 wood in 30 ticks
    expect(v.carried?.amount).toBe(15);
    run(w, 1);
    expect(order(w, 2).phase).toBe('toDropOff');
  });

  it('never carries more than capacity even when one tick would harvest several units', () => {
    const w = townWorld(
      (s) => {
        villager(s, 11.5, 3.5);
        tree(s, 12, 3, 1000);
      },
      makeData({ wood: 100 }, 3), // 5 per tick, capacity 3
    );
    const v = unitOf(w, 2);
    tick(w, [gatherCmd(1, [2], 3)]);
    for (let i = 0; i < 200; i++) {
      tick(w);
      expect(v.carried?.amount ?? 0).toBeLessThanOrEqual(3);
    }
    expect(w.state.players[1]!.resources.wood % 3).toBe(0);
    expect(w.state.players[1]!.resources.wood).toBeGreaterThan(0);
  });
});

describe('drop-off choice', () => {
  function dropWorld(build: (s: World['state']) => void): World {
    // The villager stands at (20, 20.5), beside the tree at tile (21,20).
    return makeWorld((s) => {
      build(s);
      villager(s, 20, 20.5);
      tree(s, 21, 20, 1000);
    });
  }

  function chosen(w: World): number | null {
    const v = unitOf(w, w.state.entities.find((e) => e.kind === 'unit')!.id);
    tick(w, [gatherCmd(1, [v.id], w.state.entities.find((e) => e.kind === 'node')!.id)]);
    expect(runUntil(w, () => (v.currentOrder as GatherOrderState).phase === 'toDropOff', 200)).toBeGreaterThan(0);
    return (v.currentOrder as GatherOrderState).dropOffId;
  }

  it('picks the nearest completed drop-off that accepts the resource', () => {
    const w = dropWorld((s) => {
      building(s, 'lumberCamp', 14, 20); // id 1, centre (15,21): 5 tiles
      building(s, 'lumberCamp', 30, 20); // id 2, 10 tiles
      building(s, 'mill', 17, 20); // id 3, closest but food only
    });
    expect(chosen(w)).toBe(1);
  });

  it('breaks distance ties by lowest id', () => {
    const w = dropWorld((s) => {
      building(s, 'lumberCamp', 24, 20); // id 1 east, centre (25,21)
      building(s, 'lumberCamp', 14, 20); // id 2 west, centre (15,21): same distance
    });
    expect(chosen(w)).toBe(1);
    const w2 = dropWorld((s) => {
      building(s, 'lumberCamp', 14, 20); // id 1 west
      building(s, 'lumberCamp', 24, 20); // id 2 east
    });
    expect(chosen(w2)).toBe(1);
  });

  it('ignores unfinished buildings and other players buildings', () => {
    const w = dropWorld((s) => {
      building(s, 'lumberCamp', 17, 20, false); // 1: unfinished, nearest
      building(s, 'lumberCamp', 22, 24, true, 2); // 2: enemy
      building(s, 'townCenter', 2, 2); // 3: far but valid
    });
    expect(chosen(w)).toBe(3);
  });

  it('goes idle holding the load, with an event, when no drop-off is valid', () => {
    const w = dropWorld((s) => {
      building(s, 'lumberCamp', 17, 20, false);
    });
    const v = unitOf(w, 2);
    tick(w, [gatherCmd(1, [2], 3)]);
    run(w, 100);
    expect(v.currentOrder).toBeNull();
    expect(v.carried).toEqual({ type: 'wood', amount: 10 });
    expect(idleEvents(w)).toBe(1);
    expect(nodeOf(w, 3)!.gathererIds).toEqual([]);
  });

  it('re-chooses when the chosen drop-off disappears on the way', () => {
    const w = dropWorld((s) => {
      building(s, 'lumberCamp', 14, 20); // 1 near
      building(s, 'townCenter', 2, 2); // 2 far
    });
    const v = unitOf(w, 3);
    expect(chosen(w)).toBe(1);
    w.state.entities = w.state.entities.filter((e) => e.id !== 1);
    refreshOccupancy(w);
    run(w, 1);
    expect((v.currentOrder as GatherOrderState).dropOffId).toBe(2);
  });
});

describe('depletion and retargeting', () => {
  it('retargets to the nearest same-resource node within 8 tiles of the depleted one', () => {
    const w = makeWorld((s) => {
      building(s, 'townCenter', 14, 18); // 1: close drop-off
      villager(s, 19.5, 20.5); // 2
      tree(s, 20, 20, 5); // 3 depleted first
      tree(s, 27, 20, 100); // 4 at 7
      tree(s, 20, 25, 100); // 5 at 5: the nearest
      createNode(s, 'berryBush', 20, 22, 100); // 6: other resource, nearest of all
    });
    tick(w, [gatherCmd(1, [2], 3)]);
    expect(runUntil(w, () => nodeOf(w, 3) === undefined, 300)).toBeGreaterThan(0);
    run(w, 2);
    const o = order(w, 2);
    expect(o.targetId).toBe(5);
    expect(o.anchor).toEqual({ x: 20.5, y: 25.5 });
    expect(nodeOf(w, 5)!.gathererIds).toEqual([2]);
    expect(nodeOf(w, 4)!.gathererIds).toEqual([]);
    expect(nodeOf(w, 6)!.gathererIds).toEqual([]);
    // it keeps its 5 wood and tops up from the new tree
    expect(unitOf(w, 2).carried?.type).toBe('wood');
  });

  it('accepts a node exactly 8 tiles away and refuses one 9 tiles away', () => {
    expect(GATHER_RETARGET_RADIUS).toBe(8);
    const at = (tx: number) => {
      const w = makeWorld((s) => {
        building(s, 'townCenter', 14, 18); // 1
        villager(s, 19.5, 20.5); // 2
        tree(s, 20, 20, 5); // 3
        tree(s, tx, 20, 100); // 4
      });
      tick(w, [gatherCmd(1, [2], 3)]);
      run(w, 3000);
      return w;
    };
    const nearWorld = makeWorld((s) => {
      building(s, 'townCenter', 14, 18);
      villager(s, 19.5, 20.5);
      tree(s, 20, 20, 5);
      tree(s, 28, 20, 100);
    });
    tick(nearWorld, [gatherCmd(1, [2], 3)]);
    expect(runUntil(nearWorld, () => nodeOf(nearWorld, 3) === undefined, 300)).toBeGreaterThan(0);
    run(nearWorld, 2);
    expect(order(nearWorld, 2).targetId).toBe(4);
    const far = at(29);
    expect(unitOf(far, 2).currentOrder).toBeNull();
    // the 5 wood it had was delivered before it went idle, and the far tree is untouched
    expect(far.state.players[1]!.resources.wood).toBe(5);
    expect(unitOf(far, 2).carried).toBeNull();
    expect(nodeOf(far, 4)!.amount).toBe(100);
    expect(idleEvents(far)).toBe(1);
  });

  it('treats a node removed by cleanup as depleted', () => {
    const w = makeWorld((s) => {
      building(s, 'townCenter', 14, 18); // 1
      villager(s, 19.5, 20.5); // 2
      tree(s, 20, 20, 100); // 3
      tree(s, 20, 24, 100); // 4
    });
    tick(w, [gatherCmd(1, [2], 3)]);
    run(w, 10);
    w.state.entities = w.state.entities.filter((e) => e.id !== 3);
    refreshOccupancy(w);
    run(w, 5);
    expect(order(w, 2).targetId).toBe(4);
    expect(nodeOf(w, 4)!.gathererIds).toEqual([2]);
    // and when nothing else is left it idles
    w.state.entities = w.state.entities.filter((e) => e.id !== 4);
    refreshOccupancy(w);
    run(w, 300);
    expect(unitOf(w, 2).currentOrder).toBeNull();
    expect(idleEvents(w)).toBe(1);
  });

  it('a lone villager clears an isolated tree stand completely and goes idle', () => {
    const w = makeWorld(
      (s) => {
        building(s, 'townCenter', 2, 2); // 1
        building(s, 'lumberCamp', 14, 20); // 2
        villager(s, 6.5, 3.5); // 3
        for (const [x, y] of [
          [20, 20],
          [22, 20],
          [21, 23],
          [19, 22],
          [24, 22],
        ] as const) {
          tree(s, x, y, 100);
        }
      },
      makeData(PLAN_RATES),
    );
    const v = unitOf(w, 3);
    const nodeCount = () => w.state.entities.filter((e) => e.kind === 'node').length;
    tick(w, [gatherCmd(1, [3], 4)]);
    const ticks = runUntil(w, () => nodeCount() === 0 && v.currentOrder === null, 30000);
    expect(ticks).toBeGreaterThan(0);
    expect(w.state.players[1]!.resources.wood).toBe(500);
    expect(v.carried).toBeNull();
    expect(idleEvents(w)).toBe(1);
    expect(w.events.filter((e) => e.type === 'ResourceNodeDepleted')).toHaveLength(5);
    expect(w.state.pathQueue).toEqual([]);
  });
});

describe('gatherer limits', () => {
  it('lets one villager per tree and sends the next to a free tree within 8 tiles', () => {
    const w = makeWorld((s) => {
      building(s, 'townCenter', 14, 18);
      villager(s, 19.5, 20.5); // 2
      villager(s, 19.5, 21.5); // 3
      tree(s, 20, 20, 100); // 4
      tree(s, 20, 25, 100); // 5
      tree(s, 20, 29, 100); // 6 (9 away: out of reach for the retarget)
    });
    tick(w, [gatherCmd(1, [2, 3], 4)]);
    run(w, 3);
    expect(nodeOf(w, 4)!.gathererIds).toEqual([2]);
    expect(order(w, 3).targetId).toBe(5);
    expect(nodeOf(w, 5)!.gathererIds).toEqual([3]);
    expect(nodeOf(w, 6)!.gathererIds).toEqual([]);
  });

  it('idles a villager whose node is full when nothing else is in range', () => {
    const w = makeWorld((s) => {
      building(s, 'townCenter', 14, 18);
      villager(s, 19.5, 20.5);
      villager(s, 19.5, 21.5);
      tree(s, 20, 20, 100);
    });
    tick(w, [gatherCmd(1, [2, 3], 4)]);
    run(w, 3);
    expect(unitOf(w, 3).currentOrder).toBeNull();
    expect(idleEvents(w)).toBe(1);
    expect(nodeOf(w, 4)!.gathererIds).toEqual([2]);
  });

  it('allows six gatherers on a gold deposit and retargets the seventh', () => {
    const w = makeWorld((s) => {
      building(s, 'townCenter', 14, 18); // 1
      createNode(s, 'goldDeposit', 20, 20, 800); // 2
      createNode(s, 'goldDeposit', 20, 26, 800); // 3
      for (let i = 0; i < 7; i++) villager(s, 17.5, 14.5 + i); // 4..10
    });
    tick(w, [gatherCmd(1, [4, 5, 6, 7, 8, 9, 10], 2)]);
    run(w, 3);
    expect(nodeOf(w, 2)!.gathererIds).toEqual([4, 5, 6, 7, 8, 9]);
    expect(nodeOf(w, 3)!.gathererIds).toEqual([10]);
  });

  it('keeps gatherer lists correct on stop, redirect, delete and a replacing order', () => {
    const w = makeWorld((s) => {
      building(s, 'townCenter', 14, 18); // 1
      villager(s, 19.5, 20.5); // 2
      villager(s, 19.5, 24.5); // 3
      villager(s, 19.5, 27.5); // 4
      tree(s, 20, 20, 100); // 5
      tree(s, 20, 24, 100); // 6
      tree(s, 20, 27, 100); // 7
    });
    tick(w, [gatherCmd(1, [2], 5), gatherCmd(1, [3], 6), gatherCmd(1, [4], 7)]);
    run(w, 3);
    expect([5, 6, 7].map((id) => nodeOf(w, id)!.gathererIds)).toEqual([[2], [3], [4]]);
    tick(w, [{ type: 'stop', playerId: 1, seq: 100, unitIds: [2] }]);
    tick(w, [moveCmd(1, [3], 30, 30)]);
    tick(w, [{ type: 'delete', playerId: 1, seq: 101, entityIds: [4] }]);
    expect([5, 6, 7].map((id) => nodeOf(w, id)!.gathererIds)).toEqual([[], [], []]);
    // a new gather command replaces the old order and moves the slot
    tick(w, [gatherCmd(1, [3], 6)]);
    run(w, 2);
    tick(w, [gatherCmd(1, [3], 7)]);
    run(w, 2);
    expect([6, 7].map((id) => nodeOf(w, id)!.gathererIds)).toEqual([[], [3]]);
  });
});

describe('idle event', () => {
  it('is emitted once, only when the villager has nothing queued', () => {
    const w = makeWorld((s) => {
      villager(s, 19.5, 20.5); // 1
      villager(s, 19.5, 24.5); // 2
      tree(s, 20, 20, 3); // 3
      tree(s, 20, 24, 3); // 4
    });
    tick(w, [gatherCmd(1, [1], 3)]);
    tick(w, [gatherCmd(1, [2], 4), { type: 'move', playerId: 1, seq: 50, unitIds: [2], x: 30, y: 30, queue: true }]);
    run(w, 200);
    const idle = w.events.filter((e) => e.type === 'VillagerIdle');
    expect(idle).toEqual([{ type: 'VillagerIdle', playerId: 1, unitId: 1 }]);
    expect(unitOf(w, 2).pos.x).toBeCloseTo(30, 0); // walked on to the queued move
  });
});

describe('carried load', () => {
  it('discards a carried load of another resource when switching to a new resource', () => {
    const w = townWorld((s) => {
      const v = villager(s, 19.5, 20.5); // 2
      v.carried = { type: 'wood', amount: 7 };
      createNode(s, 'berryBush', 20, 20, 150); // 3
    });
    tick(w, [gatherCmd(1, [2], 3)]);
    run(w, 1);
    expect(unitOf(w, 2).carried).toBeNull();
    run(w, 400);
    expect(w.state.players[1]!.resources.wood).toBe(0);
    expect(w.state.players[1]!.resources.food).toBeGreaterThan(0);
    expect(w.state.players[1]!.resources.food % 10).toBe(0);
  });

  it('keeps a carried load of the same resource and tops it up', () => {
    const w = townWorld((s) => {
      const v = villager(s, 19.5, 20.5); // 2
      v.carried = { type: 'wood', amount: 4 };
      tree(s, 20, 20, 100); // 3
    });
    tick(w, [gatherCmd(1, [2], 3)]);
    expect(runUntil(w, () => w.state.players[1]!.resources.wood > 0, 3000)).toBeGreaterThan(0);
    expect(w.state.players[1]!.resources.wood).toBe(10);
    expect(nodeOf(w, 3)!.amount).toBe(94);
  });
});

describe('farms', () => {
  it('gathers from a completed own farm forever, one villager at a time', () => {
    const w = makeWorld((s) => {
      building(s, 'mill', 14, 20); // 1
      building(s, 'farm', 20, 20); // 2
      villager(s, 19.5, 20.5); // 3
    });
    const v = unitOf(w, 3);
    tick(w, [gatherCmd(1, [3], 2)]);
    run(w, 3);
    const farm = w.state.entities.find((e) => e.id === 2)!;
    expect(farm.kind === 'building' && farm.gathererIds).toEqual([3]);
    for (let i = 0; i < 2000; i++) {
      tick(w);
      expect(v.carried?.amount ?? 0).toBeLessThanOrEqual(10);
    }
    expect(w.state.players[1]!.resources.food).toBeGreaterThanOrEqual(100);
    expect(w.state.players[1]!.resources.food % 10).toBe(0);
    expect(w.state.entities.some((e) => e.id === 2)).toBe(true);
    expect(order(w, 3).targetId).toBe(2);
  });

  it('sends a second villager to another farm in range, or idles it', () => {
    const w = makeWorld((s) => {
      building(s, 'mill', 14, 20); // 1
      building(s, 'farm', 20, 20); // 2
      building(s, 'farm', 20, 26); // 3
      villager(s, 19.5, 20.5); // 4
      villager(s, 19.5, 21.5); // 5
      villager(s, 19.5, 22.5); // 6
    });
    tick(w, [gatherCmd(1, [4, 5, 6], 2)]);
    run(w, 3);
    const gatherers = (id: number) => {
      const b = w.state.entities.find((e) => e.id === id)!;
      return b.kind === 'building' ? b.gathererIds : [];
    };
    expect(gatherers(2)).toEqual([4]);
    expect(gatherers(3)).toEqual([5]);
    expect(unitOf(w, 6).currentOrder).toBeNull();
    expect(idleEvents(w)).toBe(1);
  });

  it('does not let a villager farm an unfinished farm via an old order', () => {
    const w = makeWorld((s) => {
      villager(s, 19.5, 20.5); // 1
      building(s, 'farm', 20, 20, false); // 2
    });
    tick(w, [gatherCmd(1, [1], 2)]);
    expect(rejections(w)).toEqual(['notConstructed']);
  });
});

describe('drop off command', () => {
  it('walks to the building, deposits and idles without an idle event', () => {
    const w = makeWorld((s) => {
      building(s, 'lumberCamp', 14, 20); // 1
      const v = villager(s, 25.5, 20.5); // 2
      v.carried = { type: 'wood', amount: 6 };
    });
    tick(w, [dropOffCmd(1, [2], 1)]);
    expect(rejections(w)).toEqual([]);
    run(w, 100);
    expect(w.state.players[1]!.resources.wood).toBe(6);
    expect(unitOf(w, 2).carried).toBeNull();
    expect(unitOf(w, 2).currentOrder).toBeNull();
    expect(idleEvents(w)).toBe(0);
  });

  it('validates the units, the building and what is carried', () => {
    const w = makeWorld((s) => {
      building(s, 'lumberCamp', 14, 20); // 1
      building(s, 'lumberCamp', 14, 24, false); // 2
      building(s, 'mill', 14, 28); // 3
      building(s, 'lumberCamp', 30, 30, true, 2); // 4
      villager(s, 25.5, 20.5); // 5, empty-handed
      const loaded = villager(s, 25.5, 22.5); // 6
      loaded.carried = { type: 'wood', amount: 3 };
      tree(s, 5, 30); // 7
    });
    const cases: [Command, string][] = [
      [dropOffCmd(1, [5], 1), 'cannotPerform'],
      [dropOffCmd(1, [6], 99), 'unknownEntity'],
      [dropOffCmd(1, [6], 7), 'invalidTarget'],
      [dropOffCmd(1, [6], 2), 'notConstructed'],
      [dropOffCmd(1, [6], 3), 'invalidTarget'],
      [dropOffCmd(1, [6], 4), 'notOwner'],
      [dropOffCmd(1, [99], 1), 'unknownEntity'],
    ];
    for (const [cmd, reason] of cases) {
      w.events = [];
      tick(w, [cmd]);
      expect(rejections(w), reason).toEqual([reason]);
    }
    expect(unitOf(w, 6).currentOrder).toBeNull();
    expect(unitOf(w, 6).carried).toEqual({ type: 'wood', amount: 3 });
  });
});

describe('determinism', () => {
  function build(): { sim: Sim; data: ReturnType<typeof makeData> } {
    const data = makeData(PLAN_RATES);
    const w = makeWorld((s) => {
      building(s, 'townCenter', 2, 2); // 1
      building(s, 'lumberCamp', 14, 20); // 2
      building(s, 'mill', 14, 26); // 3
      building(s, 'farm', 20, 30); // 4
      createNode(s, 'goldDeposit', 28, 8, 800); // 5
      createNode(s, 'berryBush', 20, 26, 150); // 6
      for (const [x, y] of [
        [20, 20],
        [22, 20],
        [21, 23],
        [19, 22],
      ] as const) {
        tree(s, x, y, 100); // 7..10
      }
      for (let i = 0; i < 6; i++) villager(s, 6.5, 2.5 + i * 0.5); // 11..16
    }, data);
    return { sim: simFromState(w.state, data), data };
  }

  const script = (tickNo: number): Command[] => {
    switch (tickNo) {
      case 1:
        return [gatherCmd(1, [11, 12, 13], 7), gatherCmd(1, [14], 5), gatherCmd(1, [15], 6), gatherCmd(1, [16], 4)];
      case 150:
        return [gatherCmd(1, [14], 8, true)];
      case 400:
        return [moveCmd(1, [12], 30, 30)];
      case 450:
        return [gatherCmd(1, [12], 5)];
      default:
        return [];
    }
  };

  it('two runs with gather commands produce identical hashes every tick', () => {
    const a = build().sim;
    const b = build().sim;
    for (let t = 0; t < 1200; t++) {
      a.step(script(t));
      b.step(script(t));
      expect(hashState(a.state)).toBe(hashState(b.state));
    }
    // and the economy actually ran
    expect(a.state.players[1]!.resources.wood + a.state.players[1]!.resources.gold).toBeGreaterThan(0);
  });

  it('a save/load in the middle of gathering continues identically', () => {
    const { sim: a, data } = build();
    for (let t = 0; t < 500; t++) a.step(script(t));
    const loaded = deserialize(serialize(a), data);
    expect(hashState(loaded.state)).toBe(hashState(a.state));
    for (let t = 500; t < 1200; t++) {
      a.step(script(t));
      loaded.step(script(t));
      expect(hashState(loaded.state)).toBe(hashState(a.state));
    }
    expect(serialize(loaded)).toBe(serialize(a));
  });
});
