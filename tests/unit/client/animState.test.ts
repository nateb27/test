import { Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { SpriteAnimation, SpriteAsset } from '../../../src/client/art/manifest';
import { makeUnit } from '../../../src/client/render/dev/fixtureState';
import { animFrame, resolveUnitState, unitAnimDetail } from '../../../src/client/render/entities';
import type { UnitEntity } from '../../../src/sim/types';

const anim = (n: number, extra: Partial<SpriteAnimation> = {}): SpriteAnimation => ({ frames: Array.from({ length: n }, () => Texture.EMPTY), frameMs: 100, mirrorX: false, ...extra });

describe('unit animation state', () => {
  it('picks the job and the load', () => {
    const work = makeUnit(1, 1, 'villager', 5, 5, 0, 'work');
    expect(unitAnimDetail(work)).toBe('chop');
    const gather = (resource: 'food' | 'gold' | 'stone'): UnitEntity => ({ ...work, currentOrder: { ...(work.currentOrder as Extract<UnitEntity['currentOrder'], { type: 'gather' }>), resource, targetId: 9 } });
    expect(unitAnimDetail(gather('gold'))).toBe('mine');
    expect(unitAnimDetail(gather('stone'))).toBe('mine');
    expect(unitAnimDetail(gather('food'), () => 'berryBush')).toBe('forage');
    expect(unitAnimDetail(gather('food'), () => 'farm')).toBe('farm');
    expect(unitAnimDetail({ ...work, currentOrder: { type: 'build', buildingId: 3, phase: 'building' } })).toBe('build');
    const carry = makeUnit(2, 1, 'villager', 5, 5, 0, 'carry');
    expect(unitAnimDetail(carry)).toBe('carryWood');
    expect(unitAnimDetail({ ...carry, carried: { type: 'gold', amount: 3 } })).toBe('carryGold');
    expect(unitAnimDetail(makeUnit(3, 1, 'villager', 5, 5, 0, 'walk'))).toBe('walk');
    expect(unitAnimDetail(makeUnit(4, 1, 'villager', 5, 5, 0, 'idle'))).toBe('idle');
  });

  it('falls back to the generic state when the art lacks the specific one', () => {
    const basic = { states: ['idle', 'walk', 'work', 'carry'] } as unknown as SpriteAsset;
    expect(resolveUnitState(basic, 'chop')).toBe('work');
    expect(resolveUnitState(basic, 'carryStone')).toBe('carry');
    expect(resolveUnitState(basic, 'death')).toBe('idle');
    const full = { states: ['idle', 'walk', 'chop', 'carryStone'] } as unknown as SpriteAsset;
    expect(resolveUnitState(full, 'chop')).toBe('chop');
    expect(resolveUnitState(full, 'carryStone')).toBe('carryStone');
  });

  it('advances locomotion by distance, holds one-shots, runs the rest on the clock', () => {
    const walk = anim(8, { cycle: 0.8 });
    expect(animFrame(walk, 12345, 0)).toBe(0);
    expect(animFrame(walk, 99999, 0.1)).toBe(1);
    expect(animFrame(walk, 0, 0.75)).toBe(7);
    expect(animFrame(walk, 0, 0.8)).toBe(0);
    const death = anim(7, { loop: false });
    expect(animFrame(death, 0, null, 0)).toBe(0);
    expect(animFrame(death, 0, null, 350)).toBe(3);
    expect(animFrame(death, 0, null, 10_000)).toBe(6);
    expect(animFrame(death, 5000, null)).toBe(6);
    expect(animFrame(anim(2), 250, null)).toBe(0);
    expect(animFrame(anim(2), 150, null)).toBe(1);
    expect(animFrame(anim(1), 150, 3)).toBe(0);
  });
});
