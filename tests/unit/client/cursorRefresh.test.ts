/**
 * The sword cursor follows the world under a resting pointer (defect fix): it goes when the hovered enemy dies or the
 * selection changes, without the pointer moving. The cursor controller recomputes on `refresh()`, which the mode
 * controller calls every frame (`GameInput.onFrame`) and on selection changes.
 */

import { describe, expect, it } from 'vitest';
import { registry } from '../../../src/data';
import { createCursorController } from '../../../src/client/input/placement';
import { makeUnit } from '../../../src/client/render/dev/fixtureState';
import type { EntityId, ReadonlyEntity } from '../../../src/sim/types';

function fakeCanvas() {
  const listeners = new Map<string, (e: { clientX: number; clientY: number }) => void>();
  return {
    style: { cursor: '' },
    dataset: {} as Record<string, string>,
    addEventListener: (t: string, l: (e: { clientX: number; clientY: number }) => void) => listeners.set(t, l),
    removeEventListener: (t: string) => listeners.delete(t),
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    move: (x: number, y: number) => listeners.get('mousemove')?.({ clientX: x, clientY: y }),
  };
}

describe('sword cursor under a resting pointer', () => {
  it('goes when the hovered enemy dies or the selection no longer can attack it, without a pointer move', () => {
    const spear = makeUnit(1, 1, 'spearman', 10, 10, 0);
    const foe = makeUnit(2, 2, 'swordsman', 11, 10, 0);
    const world = new Map<EntityId, ReadonlyEntity>([
      [1, spear],
      [2, foe],
    ]);
    let selection: EntityId[] = [1];
    const selectionListeners = new Set<() => void>();
    const canvas = fakeCanvas();
    const cursors = createCursorController({
      canvas: canvas as unknown as HTMLCanvasElement,
      // The renderer's pick uses the last frame's sprites: it still finds the enemy's id after it died.
      pickEntity: () => 2,
      entityById: (id) => world.get(id),
      selection: () => selection,
      playerId: 1,
      registry,
      modeKind: () => null,
      onSelection: (l) => {
        selectionListeners.add(l);
        return () => selectionListeners.delete(l);
      },
    });
    canvas.move(50, 50);
    expect(cursors.current()).toBe('attack');
    expect(canvas.dataset.cursor).toBe('attack');

    // The selection changes to nothing (Esc): the sword goes at once.
    selection = [];
    for (const l of selectionListeners) l();
    expect(cursors.current()).toBe('default');
    selection = [1];
    for (const l of selectionListeners) l();
    expect(cursors.current()).toBe('attack');

    // The enemy dies under the resting pointer: the next frame's refresh drops the sword.
    world.set(2, { ...foe, hp: 0 });
    cursors.refresh();
    expect(cursors.current()).toBe('default');
    world.delete(2);
    cursors.refresh();
    expect(cursors.current()).toBe('default');
    expect(canvas.dataset.cursor).toBeUndefined();
    expect(canvas.style.cursor).toBe('');
    cursors.destroy();
  });
});
