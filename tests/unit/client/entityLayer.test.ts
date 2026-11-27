/**
 * EntityLayer (WP12 rewrite): the sprites it keeps between frames, the order
 * and records it hands to picking and the overlays, and what it does when the
 * entity set changes. Pixi `Sprite`/`Container` work without a renderer.
 */

import { Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { registry } from '../../../src/data';
import type { SpriteAnimation, SpriteAsset } from '../../../src/client/art/manifest';
import { makeBuilding, makeNode, makeUnit } from '../../../src/client/render/dev/fixtureState';
import { EntityLayer } from '../../../src/client/render/entities';
import { worldToScreen } from '../../../src/client/render/iso';
import { pickDrawn } from '../../../src/client/render/picking';
import type { GameState } from '../../../src/sim/types';
import { M2_STATE_FIELDS, m2PlayerFields } from '../../sim/fixtures';

function manifest() {
  const frames = [new Texture(), new Texture()];
  const asset = (id: string): SpriteAsset =>
    ({
      id,
      anchor: { x: 0.5, y: 0.8 },
      states: ['default'],
      animation: (): SpriteAnimation => ({ frames, frameMs: 0, mirrorX: false }),
    }) as unknown as SpriteAsset;
  let lookups = 0;
  return {
    api: {
      has: () => true,
      sprite: asset,
      teamSprite: (id: string) => {
        lookups++;
        return asset(id);
      },
    } as never,
    lookups: () => lookups,
  };
}

function state(entities: GameState['entities']): GameState {
  return {
    tick: 0,
    seed: 1,
    mapSeed: 1,
    rng: { a: 1, b: 2, c: 3, d: 4 },
    nextEntityId: 100,
    occupancyVersion: 0,
    nextPathRequestId: 1,
    map: { width: 60, height: 60, tiles: [] },
    players: [
      { id: 0, civ: null, color: 0x9e9e9e, resources: { food: 0, wood: 0, gold: 0, stone: 0 }, age: 1, popUsed: 0, popCap: 0, researched: [], cheats: { instantBuild: false, instantResearch: false }, ...m2PlayerFields(0) },
      { id: 1, civ: 'byzantines', color: 0x2255cc, resources: { food: 0, wood: 0, gold: 0, stone: 0 }, age: 1, popUsed: 0, popCap: 0, researched: [], cheats: { instantBuild: false, instantResearch: false }, ...m2PlayerFields(1) },
    ],
    entities,
    pathQueue: [],
    objectives: { entries: [] },
    ...M2_STATE_FIELDS(),
  };
}

const everywhere = { minX: -5000, minY: -5000, maxX: 5000, maxY: 5000 };

describe('EntityLayer', () => {
  it('draws back to front with units interleaved among buildings and nodes, and records what it drew', () => {
    const m = manifest();
    const layer = new EntityLayer(m.api, registry);
    const s = state([
      makeBuilding(1, 1, 'house', 10, 10, 1),
      makeNode(2, 'tree', 12, 12),
      makeUnit(3, 1, 'villager', 11.5, 11.5, 1),
      makeUnit(4, 1, 'villager', 3, 3, 1),
      makeNode(5, 'tree', 30, 30),
    ]);
    layer.update(s, 0, everywhere, 0);
    expect(layer.drawn.map((d) => d.id)).toEqual([4, 1, 3, 2, 5]);
    for (const d of layer.drawn) expect(layer.getDrawn(d.id)).toBe(d);
    // The sprites' zIndex order is the draw order.
    const bySprite = [...layer.container.children].sort((a, b) => a.zIndex - b.zIndex).map((c) => [c.x, c.y]);
    expect(bySprite).toEqual(layer.drawn.map((d) => [worldToScreen(d.wx, d.wy).x, worldToScreen(d.wx, d.wy).y]));
    const house = layer.drawn.find((d) => d.id === 1)!;
    expect(house).toMatchObject({ kind: 'building', size: 2, owner: 1, wx: 11, wy: 11, depth: 22 });
    expect(pickDrawn(layer.drawn, worldToScreen(11, 11).x, worldToScreen(11, 11).y)).toBe(1);
  });

  it('interpolates unit positions and keeps the same record object between frames', () => {
    const layer = new EntityLayer(manifest().api, registry);
    const unit = makeUnit(3, 1, 'villager', 10, 10, 1);
    unit.prevPos = { x: 9, y: 10 };
    const s = state([unit]);
    layer.update(s, 0.5, everywhere, 0);
    const first = layer.drawn[0]!;
    expect(first.wx).toBeCloseTo(9.5, 9);
    layer.update(s, 1, everywhere, 16);
    expect(layer.drawn[0]).toBe(first);
    expect(first.wx).toBeCloseTo(10, 9);
  });

  it('culls to the viewport plus margin, hides sprites that left it and brings them back', () => {
    const layer = new EntityLayer(manifest().api, registry);
    const s = state([makeNode(1, 'tree', 5, 5), makeNode(2, 'tree', 50, 50)]);
    const a = worldToScreen(5.5, 5.5);
    const near = { minX: a.x - 50, maxX: a.x + 50, minY: a.y - 50, maxY: a.y + 50 };
    layer.update(s, 0, near, 0);
    expect(layer.drawn.map((d) => d.id)).toEqual([1]);
    expect(layer.getDrawn(2)).toBeUndefined();
    layer.update(s, 0, everywhere, 0);
    expect(layer.drawn.map((d) => d.id)).toEqual([1, 2]);
    const sprite = layer.container.children[1]!;
    expect(sprite.visible).toBe(true);
    layer.update(s, 0, near, 0);
    expect(sprite.visible).toBe(false);
    expect(layer.getDrawn(2)).toBeUndefined();
    layer.update(s, 0, everywhere, 0);
    expect(sprite.visible).toBe(true);
  });

  it('notices entities that appear and disappear (sorted statics are rebuilt, sprites destroyed)', () => {
    const layer = new EntityLayer(manifest().api, registry);
    const tree = makeNode(1, 'tree', 10, 10);
    const entities: GameState['entities'] = [tree];
    const s = state(entities);
    layer.update(s, 0, everywhere, 0);
    expect(layer.drawn.map((d) => d.id)).toEqual([1]);
    // A building is added in place (ids only grow), as the sim does.
    entities.push(makeBuilding(2, 1, 'house', 2, 2, 1));
    layer.update(s, 0, everywhere, 0);
    expect(layer.drawn.map((d) => d.id)).toEqual([2, 1]);
    expect(layer.container.children).toHaveLength(2);
    // The tree is depleted: the sim replaces the array.
    s.entities = entities.filter((e) => e.id !== 1);
    layer.update(s, 0, everywhere, 0);
    expect(layer.drawn.map((d) => d.id)).toEqual([2]);
    expect(layer.container.children).toHaveLength(1);
    expect(layer.getDrawn(1)).toBeUndefined();
    // A removed unit's sprite goes too.
    const withUnit: GameState['entities'] = [...s.entities, makeUnit(3, 1, 'villager', 5, 5, 1)];
    s.entities = withUnit;
    layer.update(s, 0, everywhere, 0);
    expect(layer.container.children).toHaveLength(2);
    s.entities = withUnit.filter((e) => e.id !== 3);
    layer.update(s, 0, everywhere, 0);
    expect(layer.container.children).toHaveLength(1);
  });

  it('looks each sprite up once, not once per frame', () => {
    const m = manifest();
    const layer = new EntityLayer(m.api, registry);
    const s = state([makeBuilding(1, 1, 'house', 10, 10, 1), makeNode(2, 'tree', 12, 12), makeUnit(3, 1, 'villager', 11, 11, 1)]);
    for (let i = 0; i < 20; i++) layer.update(s, 0.3, everywhere, i * 16);
    expect(m.lookups()).toBe(3);
  });

  it('shows construction stages and hit boxes follow the sprite', () => {
    const layer = new EntityLayer(manifest().api, registry);
    const b = makeBuilding(1, 1, 'house', 10, 10, 0.1);
    b.progress = 0.1;
    const s = state([b]);
    layer.update(s, 0, everywhere, 0);
    const d = layer.drawn[0]!;
    expect(d.bounds.maxX).toBeGreaterThanOrEqual(d.bounds.minX);
    expect(d.hit.minX).toBeGreaterThanOrEqual(d.bounds.minX);
  });

  it('sprite layers follow the draw order while units walk past buildings and nodes', () => {
    const layer = new EntityLayer(manifest().api, registry);
    const entities: GameState['entities'] = [];
    let id = 1;
    for (let i = 0; i < 25; i++) entities.push(makeNode(id++, 'tree', 5 + ((i * 7) % 40), 5 + ((i * 11) % 40)));
    for (let i = 0; i < 8; i++) entities.push(makeBuilding(id++, 1, 'house', 6 + ((i * 13) % 38), 8 + ((i * 17) % 36), 1));
    const units = [];
    for (let i = 0; i < 40; i++) {
      const u = makeUnit(id++, 1, 'villager', 4 + i, 4 + ((i * 5) % 40), 1);
      units.push(u);
      entities.push(u);
    }
    const s = state(entities);
    for (let frame = 0; frame < 60; frame++) {
      for (const [i, u] of units.entries()) {
        u.prevPos = { ...u.pos };
        u.pos = { x: 4 + ((i * 3 + frame * 0.7) % 45), y: 4 + ((i * 5 + frame * 0.45) % 45) };
      }
      layer.update(s, (frame % 4) / 4, everywhere, frame * 16);
      const bySprite = [...layer.container.children]
        .filter((c) => c.visible)
        .sort((a, b) => a.zIndex - b.zIndex)
        .map((c) => `${c.x.toFixed(3)},${c.y.toFixed(3)}`);
      expect(bySprite, `frame ${frame}`).toEqual(layer.drawn.map((d) => `${worldToScreen(d.wx, d.wy).x.toFixed(3)},${worldToScreen(d.wx, d.wy).y.toFixed(3)}`));
      // Back to front by (depth, id).
      for (let i = 1; i < layer.drawn.length; i++) {
        const p = layer.drawn[i - 1]!;
        const q = layer.drawn[i]!;
        expect(p.depth < q.depth || (p.depth === q.depth && p.id < q.id)).toBe(true);
      }
    }
  });
});
