// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { GameInput } from '../../../src/client/input/gameInput';
import { HOTKEYS, resolveHotkey } from '../../../src/client/input/hotkeys';
import { isIdleMilitary, nextIdleMilitary } from '../../../src/client/input/selection';
import { makeUnit } from '../../../src/client/render/dev/fixtureState';
import type { WorldRendererApi } from '../../../src/client/render/renderer';
import { baseStat, createFixture } from '../../../src/client/ui/fixtures';
import { registry } from '../../../src/data';
import type { BuildingEntity, CommandInput, EntityId, Sim, UnitEntity } from '../../../src/sim/types';

const ME = 1;

describe('idle military', () => {
  const idle = makeUnit(10, ME, 'spearman', 5, 5, 0);
  const idle2 = makeUnit(12, ME, 'archer', 6, 5, 0);
  const walking: UnitEntity = { ...makeUnit(11, ME, 'spearman', 5, 6, 0), currentOrder: { type: 'move', x: 1, y: 1, phase: 'walking' } };
  const holding: UnitEntity = { ...makeUnit(13, ME, 'spearman', 5, 7, 0), currentOrder: { type: 'hold', phase: 'holding' } as never };
  const queued: UnitEntity = { ...makeUnit(14, ME, 'spearman', 5, 8, 0), orderQueue: [{ type: 'move', x: 1, y: 1 }] };
  const pathing: UnitEntity = { ...makeUnit(15, ME, 'spearman', 5, 9, 0), pendingPathRequestId: 4 };
  const villager = makeUnit(16, ME, 'villager', 5, 5, 0);
  const foe = makeUnit(17, 2, 'spearman', 9, 9, 0);
  const dead: UnitEntity = { ...makeUnit(18, ME, 'spearman', 5, 5, 0), hp: 0 };

  it('counts own idle fighting units only: no order, queue, path or pending path; hold is an order; villagers never', () => {
    expect([idle, idle2, walking, holding, queued, pathing, villager, foe, dead].filter((e) => isIdleMilitary(e, ME, registry)).map((e) => e.id)).toEqual([10, 12]);
  });

  it('cycles in ascending id order and wraps', () => {
    const list = [idle, walking, idle2, villager, foe];
    expect(nextIdleMilitary(list, ME, null, registry)).toBe(10);
    expect(nextIdleMilitary(list, ME, 10, registry)).toBe(12);
    expect(nextIdleMilitary(list, ME, 12, registry)).toBe(10);
    expect(nextIdleMilitary([villager, walking], ME, null, registry)).toBeNull();
  });
});

describe('M2 hotkeys', () => {
  const press = (code: string) => resolveHotkey(HOTKEYS, { code, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false });
  it('binds Comma to idle military and Space to the latest alert', () => {
    expect(press('Comma')).toEqual({ type: 'cycleIdleMilitary' });
    expect(press('Space')).toEqual({ type: 'jumpToAlert' });
  });
  it('keeps the military card keys on the grid slots', () => {
    expect(press('KeyA')).toEqual({ type: 'cardSlot', slot: 5 });
    expect(press('KeyS')).toEqual({ type: 'cardSlot', slot: 6 });
    expect(press('KeyZ')).toEqual({ type: 'cardSlot', slot: 10 });
    expect(press('KeyX')).toEqual({ type: 'cardSlot', slot: 11 });
    expect(press('KeyR')).toEqual({ type: 'cardSlot', slot: 3 });
  });
});

/** A `GameInput` over the fixture state with a spy for the command buffer and a fake renderer. */
function harness() {
  const fx = createFixture();
  const issued: CommandInput[] = [];
  const jumps: [number, number][] = [];
  let picked: EntityId | null = null;
  const entityById = (id: EntityId) => fx.state.entities.find((e) => e.id === id);
  const sim = {
    state: fx.state,
    step: () => [],
    query: { entityById, resolvedStat: baseStat(registry) },
  } as unknown as Sim;
  const renderer = {
    canvas: document.createElement('canvas'),
    cameraInput: { setWasd: () => {} },
    jumpTo: (x: number, y: number) => void jumps.push([x, y]),
    pickEntity: () => picked,
    canvasToWorld: (x: number, y: number) => ({ x: x / 10, y: y / 10 }),
    camera: { viewW: 800, viewH: 600 },
  } as unknown as WorldRendererApi;
  const input = new GameInput({ sim, renderer, commands: { issue: (c) => void issued.push(c) }, loop: { paused: false }, playerId: ME, registry });
  return {
    fx,
    input,
    issued,
    jumps,
    pick: (id: EntityId | null) => {
      picked = id;
    },
    entity: (id: EntityId) => entityById(id)!,
  };
}

describe('GameInput right click (M2)', () => {
  it('attacks an enemy unit with the selected units and queues with shift', () => {
    const h = harness();
    h.input.selection.set([h.fx.villagers[0]!, h.fx.spearman]);
    h.pick(h.fx.enemyUnit);
    h.input.issueContextOrder({ x: 300, y: 300 }, false);
    h.input.issueContextOrder({ x: 300, y: 300 }, true);
    expect(h.issued).toEqual([
      { type: 'attack', unitIds: [h.fx.villagers[0], h.fx.spearman], targetId: h.fx.enemyUnit, queue: false },
      { type: 'attack', unitIds: [h.fx.villagers[0], h.fx.spearman], targetId: h.fx.enemyUnit, queue: true },
    ]);
  });

  it('repairs an own damaged building with the villagers and moves the soldiers to it', () => {
    const h = harness();
    (h.entity(h.fx.house) as BuildingEntity).hp = 10;
    h.input.selection.set([h.fx.villagers[0]!, h.fx.spearman]);
    h.pick(h.fx.house);
    h.input.issueContextOrder({ x: 170, y: 110 }, false);
    expect(h.issued).toEqual([
      { type: 'repair', unitIds: [h.fx.villagers[0]], buildingId: h.fx.house, queue: false },
      { type: 'move', unitIds: [h.fx.spearman], x: 17, y: 11, queue: false },
    ]);
  });

  it('a house at full hp is not repaired', () => {
    const h = harness();
    h.input.selection.set([h.fx.villagers[0]!]);
    h.pick(h.fx.house);
    h.input.issueContextOrder({ x: 170, y: 110 }, false);
    expect(h.issued.map((c) => c.type)).toEqual(['move']);
  });
});

describe('GameInput idle military and alerts', () => {
  it('the comma action selects and centres the next idle soldier, wrapping', () => {
    const h = harness();
    const second = makeUnit(900, ME, 'archer', 20.5, 21.5, 0);
    h.fx.state.entities.push(second);
    h.input.perform({ type: 'cycleIdleMilitary' });
    expect([...h.input.selection.ids]).toEqual([h.fx.spearman]);
    h.input.perform({ type: 'cycleIdleMilitary' });
    expect([...h.input.selection.ids]).toEqual([900]);
    h.input.perform({ type: 'cycleIdleMilitary' });
    expect([...h.input.selection.ids]).toEqual([h.fx.spearman]);
    expect(h.jumps).toEqual([
      [13.5, 14.5],
      [20.5, 21.5],
      [13.5, 14.5],
    ]);
  });

  it('does nothing when nobody is idle', () => {
    const h = harness();
    (h.entity(h.fx.spearman) as UnitEntity).currentOrder = { type: 'move', x: 1, y: 1, phase: 'walking' };
    h.input.perform({ type: 'cycleIdleMilitary' });
    expect([...h.input.selection.ids]).toEqual([]);
    expect(h.jumps).toEqual([]);
  });

  it('Space centres the camera on the latest alert, and does nothing before the first one', () => {
    const h = harness();
    h.input.perform({ type: 'jumpToAlert' });
    expect(h.jumps).toEqual([]);
    h.input.noteAlert(10.5, 20.5);
    h.input.noteAlert(33, 12);
    h.input.perform({ type: 'jumpToAlert' });
    expect(h.jumps).toEqual([[33, 12]]);
  });
});
