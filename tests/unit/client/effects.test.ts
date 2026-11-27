/**
 * WP27 effect layer (PLAN-M2 7.2): the attack animation synchronised with the sim's wind-up and release, projectile
 * flight, building damage overlays, the capped game-time decals (corpses, rubble), and the layer itself on hand-made
 * states with projectiles, hp and events. Pixi sprites and containers work without a renderer, so the layer runs
 * here as it does in the browser (minus the textures' pixels).
 */

import { Container, Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { registry } from '../../../src/data';
import type { SpriteAnimation, SpriteAsset, SpriteState } from '../../../src/client/art/manifest';
import { makeBuilding, makeProjectile, makeUnit } from '../../../src/client/render/dev/fixtureState';
import { EffectLayer } from '../../../src/client/render/effects/layer';
import {
  ATTACK_ANIM_TAIL_TICKS,
  CORPSE_TICKS,
  DecalStore,
  MAX_CORPSES,
  MAX_RUBBLE,
  RUBBLE_TICKS,
  attackFrame,
  attackPhase,
  damageOverlays,
  decalAlpha,
  fireCount,
  flashAlpha,
  projectileView,
  windupTicksOf,
} from '../../../src/client/render/effects/logic';
import { EntityLayer } from '../../../src/client/render/entities';
import { HEIGHT_PX, worldToScreen } from '../../../src/client/render/iso';
import { sceneSignature } from '../../../src/client/render/redraw';
import type { GameState, SimEvent } from '../../../src/sim/types';
import { M2_STATE_FIELDS, m2PlayerFields } from '../../sim/fixtures';

describe('attack animation timing', () => {
  const W = 10; // wind-up ticks
  it('spreads frames 0..hitFrame over the wind-up so the blow frame shows on the release tick', () => {
    // Swing started in the step of tick 100: the state shown has tick 101 and windup W.
    expect(attackFrame({ windup: W, lastAttackTick: null }, 101, 0, W, 8, 5)).toBe(0);
    // Halfway through the wind-up: frame 2 of 0..5.
    expect(attackFrame({ windup: W / 2, lastAttackTick: null }, 106, 0, W, 8, 5)).toBe(2);
    // The last tick before the release, late in the frame: still before the blow.
    expect(attackFrame({ windup: 1, lastAttackTick: null }, 110, 0.5, W, 8, 5)).toBe(4);
    // The release happened in the step of tick 110 (lastAttackTick 110): the state shown has tick 111.
    expect(attackFrame({ windup: 0, lastAttackTick: 110 }, 111, 0, W, 8, 5)).toBe(5);
    // The rest of the frames over the tail, then the animation ends.
    expect(attackFrame({ windup: 0, lastAttackTick: 110 }, 111 + ATTACK_ANIM_TAIL_TICKS - 1, 0.9, W, 8, 5)).toBe(7);
    expect(attackFrame({ windup: 0, lastAttackTick: 110 }, 111 + ATTACK_ANIM_TAIL_TICKS, 0, W, 8, 5)).toBeNull();
    expect(attackFrame({ windup: 0, lastAttackTick: null }, 50, 0, W, 8, 5)).toBeNull();
  });

  it('frames never go backwards through a swing (wind-up, release, tail)', () => {
    const seq: number[] = [];
    for (let k = 0; k < W; k++) for (const a of [0, 0.5]) seq.push(attackFrame({ windup: W - k, lastAttackTick: null }, 101 + k, a, W, 2, 1)!);
    for (let k = 0; k < ATTACK_ANIM_TAIL_TICKS; k++) seq.push(attackFrame({ windup: 0, lastAttackTick: 110 }, 111 + k, 0, W, 2, 1)!);
    for (let i = 1; i < seq.length; i++) expect(seq[i]).toBeGreaterThanOrEqual(seq[i - 1]!);
    expect(seq[seq.length - ATTACK_ANIM_TAIL_TICKS]).toBe(1); // the blow (procedural hitFrame 1) at the release
    expect(attackPhase({ windup: 0, lastAttackTick: 110 }, 111, 0, W)).toEqual({ elapsed: W, released: true });
  });

  it('uses the sim wind-up in ticks', () => {
    expect(windupTicksOf(0.5)).toBe(10);
    expect(windupTicksOf(0.01)).toBe(1);
    expect(windupTicksOf(registry.unit('trebuchet').combat.windup)).toBe(40);
  });

  it('flashes a hit unit for two ticks of game time', () => {
    expect(flashAlpha(null, 10, 0)).toBe(0);
    expect(flashAlpha(99, 100, 0)).toBeCloseTo(0.4);
    expect(flashAlpha(99, 101, 0.9)).toBeCloseTo(0.4);
    expect(flashAlpha(99, 102, 0)).toBe(0);
  });
});

describe('projectile flight', () => {
  const arrow = makeProjectile(1, 'arrow', { x: 10, y: 10 }, { x: 14, y: 10 }, 10, 10);
  it('lerps from the source to the target with p = 1 - (ticksLeft - alpha) / flightTicks', () => {
    const start = projectileView(arrow, 0);
    expect(start.p).toBe(0);
    expect(start.x).toBeCloseTo(worldToScreen(10, 10).x);
    expect(start.y).toBeCloseTo(worldToScreen(10, 10).y);
    const end = projectileView({ ...arrow, ticksLeft: 0 }, 0);
    expect(end.p).toBe(1);
    expect(end.y).toBeCloseTo(worldToScreen(14, 10).y);
    expect(projectileView({ ...arrow, ticksLeft: 6 }, 1).p).toBeCloseTo(0.5);
  });

  it('arcs: arrow 0.4 tiles, stone 1.5 tiles at the top, fire flat; arrows point along their screen velocity', () => {
    const mid = (kind: 'arrow' | 'stone' | 'fire') => projectileView({ ...arrow, kind, ticksLeft: 5 }, 0);
    const ground = worldToScreen(12, 10).y;
    expect(ground - mid('arrow').y).toBeCloseTo(0.4 * HEIGHT_PX);
    expect(ground - mid('stone').y).toBeCloseTo(1.5 * HEIGHT_PX);
    expect(mid('fire').y).toBeCloseTo(ground);
    // +x on the ground runs down-right on screen; at the top of the arc an arrow flies level with that.
    expect(mid('arrow').angle).toBeCloseTo(Math.atan2(16, 32));
    // Rising at the start, falling at the end.
    expect(projectileView(arrow, 0).angle).toBeLessThan(mid('arrow').angle);
    expect(projectileView({ ...arrow, ticksLeft: 0 }, 0).angle).toBeGreaterThan(mid('arrow').angle);
  });
});

describe('building damage overlays', () => {
  it('shows nothing at 66% and above, one fire and smoke below, large fires at 2 points (3 for a Town Center) below 33%', () => {
    expect(damageOverlays(5, 2, 1)).toEqual([]);
    expect(damageOverlays(5, 2, 0.66)).toEqual([]);
    const mid = damageOverlays(5, 2, 0.5);
    expect(mid.map((o) => o.kind).sort()).toEqual(['fireSmall', 'smoke']);
    const low = damageOverlays(5, 2, 0.32);
    expect(low.filter((o) => o.kind === 'fireLarge')).toHaveLength(2);
    expect(low.filter((o) => o.kind === 'smoke')).toHaveLength(1);
    expect(damageOverlays(5, 4, 0.1).filter((o) => o.kind === 'fireLarge')).toHaveLength(3);
    expect([fireCount(2, 0.9), fireCount(2, 0.5), fireCount(3, 0.2), fireCount(4, 0.2)]).toEqual([0, 1, 2, 3]);
  });

  it('places them by a hash of the building id: stable, inside the footprint, apart from each other', () => {
    expect(damageOverlays(77, 3, 0.1)).toEqual(damageOverlays(77, 3, 0.2));
    expect(damageOverlays(77, 3, 0.1)).not.toEqual(damageOverlays(78, 3, 0.1));
    for (let id = 1; id < 200; id++) {
      const fires = damageOverlays(id, 4, 0.1).filter((o) => o.kind === 'fireLarge');
      for (const f of fires) {
        expect(f.u).toBeGreaterThan(0.1);
        expect(f.u).toBeLessThan(0.9);
        expect(f.v).toBeGreaterThan(0.1);
        expect(f.v).toBeLessThan(0.9);
      }
      for (let i = 0; i < fires.length; i++)
        for (let j = i + 1; j < fires.length; j++) expect(Math.hypot(fires[i]!.u - fires[j]!.u, fires[i]!.v - fires[j]!.v)).toBeGreaterThan(0.3);
    }
  });
});

describe('decals: game time and caps', () => {
  it('fades over the last ticks of its life', () => {
    const d = { tick: 100, life: 400, fade: 60 };
    expect(decalAlpha(d, 100)).toBe(1);
    expect(decalAlpha(d, 440)).toBe(1);
    expect(decalAlpha(d, 470)).toBeCloseTo(0.5);
    expect(decalAlpha(d, 500)).toBe(0);
  });

  it('keeps at most `max`, dropping the oldest, and prunes the expired', () => {
    const store = new DecalStore<{ tick: number; life: number; fade: number; n: number }>(3);
    for (let n = 0; n < 5; n++) store.add({ tick: 10 + n, life: 100, fade: 10, n });
    expect(store.items().map((d) => d.n)).toEqual([2, 3, 4]);
    expect(store.drain().map((d) => d.n)).toEqual([0, 1]);
    store.prune(112);
    expect(store.items().map((d) => d.n)).toEqual([3, 4]);
    expect(store.drain().map((d) => d.n)).toEqual([2]);
  });
});

// ---------------------------------------------------------------------------
// The layer on hand-made states
// ---------------------------------------------------------------------------

function stubManifest() {
  const tex = (): Texture => new Texture();
  const anims = new Map<string, SpriteAnimation>();
  const anim = (key: string, n: number, extra: Partial<SpriteAnimation> = {}): SpriteAnimation => {
    let a = anims.get(key);
    if (a === undefined) {
      a = { frames: Array.from({ length: n }, tex), frameMs: 100, mirrorX: false, ...extra };
      anims.set(key, a);
    }
    return a;
  };
  const asset = (id: string): SpriteAsset => {
    const unit = id.startsWith('unit.');
    const states: SpriteState[] = unit ? ['idle', 'walk', 'attack', 'death', 'corpse'] : ['default'];
    return {
      id,
      anchor: { x: 0.5, y: 0.8 },
      states,
      animation: (state: SpriteState) =>
        state === 'death' ? anim(`${id}|death`, 7, { loop: false, frameMs: 110 }) : state === 'attack' ? anim(`${id}|attack`, 8, { hitFrame: 5 }) : anim(`${id}|${state}`, 2),
    } as SpriteAsset;
  };
  return { has: () => true, sprite: asset, teamSprite: asset } as never;
}

function gameState(entities: GameState['entities'], tick = 100): GameState {
  return {
    tick,
    seed: 1,
    mapSeed: 1,
    rng: { a: 1, b: 2, c: 3, d: 4 },
    nextEntityId: 1000,
    occupancyVersion: 0,
    nextPathRequestId: 1,
    map: { width: 80, height: 80, tiles: [] },
    players: [
      { id: 0, civ: null, color: 0x9e9e9e, resources: { food: 0, wood: 0, gold: 0, stone: 0 }, age: 1, popUsed: 0, popCap: 0, researched: [], cheats: { instantBuild: false, instantResearch: false }, ...m2PlayerFields(0) },
      { id: 1, civ: 'byzantines', color: 0x2255cc, resources: { food: 0, wood: 0, gold: 0, stone: 0 }, age: 1, popUsed: 0, popCap: 0, researched: [], cheats: { instantBuild: false, instantResearch: false }, ...m2PlayerFields(1) },
      { id: 2, civ: 'byzantines', color: 0xcc3322, resources: { food: 0, wood: 0, gold: 0, stone: 0 }, age: 1, popUsed: 0, popCap: 0, researched: [], cheats: { instantBuild: false, instantResearch: false }, ...m2PlayerFields(2) },
    ],
    entities,
    pathQueue: [],
    objectives: { entries: [] },
    ...M2_STATE_FIELDS(),
  };
}

const everywhere = { minX: -10000, minY: -10000, maxX: 10000, maxY: 10000 };

function layers() {
  const m = stubManifest();
  const entities = new EntityLayer(m, registry);
  const effects = new EffectLayer(m, registry, entities);
  return { entities, effects };
}

const died = (unitId: number, x = 20, y = 20): SimEvent => ({ type: 'UnitDied', playerId: 2, unitId, unitType: 'swordsman', x, y, facing: 1, killerPlayerId: 1 });
const destroyed = (buildingId: number): SimEvent => ({ type: 'BuildingDestroyed', playerId: 2, buildingId, buildingType: 'house', tx: 30, ty: 30, size: 2, constructed: true, killerPlayerId: 1 });

describe('EffectLayer', () => {
  it('turns UnitDied into a corpse held for 20 s of game time, and BuildingDestroyed into rubble for 60 s', () => {
    const { entities, effects } = layers();
    const s = gameState([]);
    entities.update(s, 0, everywhere, 0);
    effects.update(s, 0, everywhere);
    effects.pushEvents([died(50), destroyed(60)]);
    expect(effects.stats()).toMatchObject({ corpses: 1, rubble: 1 });
    effects.update(s, 0, everywhere);
    expect(effects.decals.children.length).toBeGreaterThanOrEqual(2);
    // Paused: nothing changes however many frames are drawn.
    for (let i = 0; i < 5; i++) effects.update(s, 0, everywhere);
    expect(effects.stats()).toMatchObject({ corpses: 1, rubble: 1 });
    s.tick += CORPSE_TICKS;
    effects.update(s, 0, everywhere);
    expect(effects.stats()).toMatchObject({ corpses: 0, rubble: 1 });
    s.tick += RUBBLE_TICKS;
    expect(effects.stats()).toMatchObject({ corpses: 0, rubble: 0 });
  });

  it('obeys the caps: 300 corpses and 60 rubble decals, the oldest dropped first', () => {
    const { entities, effects } = layers();
    const s = gameState([]);
    entities.update(s, 0, everywhere, 0);
    effects.update(s, 0, everywhere);
    for (let i = 0; i < MAX_CORPSES + 40; i++) {
      effects.pushEvents([died(1000 + i, 10 + (i % 30), 10 + Math.floor(i / 30))]);
      s.tick += 1;
    }
    for (let i = 0; i < MAX_RUBBLE + 9; i++) effects.pushEvents([destroyed(5000 + i)]);
    effects.update(s, 0, everywhere);
    expect(effects.stats()).toMatchObject({ corpses: MAX_CORPSES, rubble: MAX_RUBBLE });
    // Sprites of dropped decals are destroyed, not leaked: corpse sprites (plus their shadows if any) and rubble only.
    expect(effects.decals.children.length).toBeLessThanOrEqual(MAX_CORPSES * 2 + MAX_RUBBLE);
  });

  it('plays the death animation once, then holds the corpse frame', () => {
    const { entities, effects } = layers();
    const s = gameState([]);
    entities.update(s, 0, everywhere, 0);
    effects.update(s, 0, everywhere);
    effects.pushEvents([died(7)]);
    effects.update(s, 0, everywhere);
    const sprite = effects.decals.children.find((c) => c.visible) as unknown as { texture: Texture };
    const first = sprite.texture;
    s.tick += 2; // 100 ms: still the first death frames
    effects.update(s, 0, everywhere);
    s.tick += 40; // 2 s: the corpse
    effects.update(s, 0, everywhere);
    const corpse = sprite.texture;
    expect(corpse).not.toBe(first);
    s.tick += 100;
    effects.update(s, 0, everywhere);
    expect(sprite.texture).toBe(corpse);
  });

  it('draws projectiles from the state (culled) and leaves an impact when one is gone', () => {
    const { entities, effects } = layers();
    const s = gameState([]);
    s.projectiles = [makeProjectile(1, 'arrow', { x: 20, y: 20 }, { x: 24, y: 20 }, 10, 8), makeProjectile(2, 'stone', { x: 20, y: 20 }, { x: 30, y: 30 }, 30, 20)];
    entities.update(s, 0, everywhere, 0);
    effects.update(s, 0.5, everywhere);
    expect(effects.drawnCounts().projectiles).toBe(2);
    expect(effects.stats().projectiles).toBe(2);
    const far = worldToScreen(70, 70);
    effects.update(s, 0.5, { minX: far.x - 10, maxX: far.x + 10, minY: far.y - 10, maxY: far.y + 10 });
    expect(effects.drawnCounts().projectiles).toBe(0);
    // Next tick the arrow has landed.
    s.tick += 1;
    s.projectiles = [s.projectiles[1]!];
    effects.update(s, 0, everywhere);
    expect(effects.stats().effects).toBe(1);
    // The impact is a one-shot of game time: it is gone a second later.
    s.tick += 20;
    effects.update(s, 0, everywhere);
    expect(effects.stats().effects).toBe(0);
  });

  it('sparks a melee release on its target, not a ranged one', () => {
    const { entities, effects } = layers();
    const sword = makeUnit(1, 1, 'swordsman', 20, 20, 0);
    const archer = makeUnit(2, 1, 'archer', 22, 20, 0);
    const victim = makeUnit(3, 2, 'spearman', 20.8, 20, 4);
    const s = gameState([sword, archer, victim]);
    entities.update(s, 0, everywhere, 0);
    effects.update(s, 0, everywhere);
    sword.currentOrder = { type: 'attack', targetId: 3, auto: false, phase: 'attacking', anchor: null, repathTick: 0 };
    sword.combat.lastAttackTick = s.tick;
    archer.combat.lastAttackTick = s.tick;
    s.tick += 1;
    effects.update(s, 0, everywhere);
    expect(effects.stats().effects).toBe(1);
  });

  it('counts fires on completed buildings below 66% hp and burns them in the entity container', () => {
    const { entities, effects } = layers();
    const house = makeBuilding(1, 1, 'house', 10, 10);
    const barracks = makeBuilding(2, 1, 'barracks', 20, 10);
    const tc = makeBuilding(3, 1, 'townCenter', 30, 10);
    const site = makeBuilding(4, 1, 'house', 40, 10, 0.5);
    house.hp = Math.floor(house.builtHp * 0.5);
    barracks.hp = Math.floor(barracks.builtHp * 0.2);
    tc.hp = Math.floor(tc.builtHp * 0.2);
    site.hp = 1;
    const s = gameState([house, barracks, tc, site]);
    entities.update(s, 0, everywhere, 0);
    effects.update(s, 0, everywhere);
    expect(effects.stats().fires).toBe(1 + 2 + 3);
    expect(effects.drawnCounts().fires).toBe(2 + 3 + 4); // with one smoke each
  });

  it('starts empty again when the state is replaced (a loaded game) or goes back in time', () => {
    const { entities, effects } = layers();
    const s = gameState([]);
    entities.update(s, 0, everywhere, 0);
    effects.update(s, 0, everywhere);
    effects.pushEvents([died(1), destroyed(2)]);
    effects.update(s, 0, everywhere);
    const loaded = gameState([], 50);
    entities.update(loaded, 0, everywhere, 0);
    effects.update(loaded, 0, everywhere);
    expect(effects.stats()).toMatchObject({ corpses: 0, rubble: 0, effects: 0 });
  });

  it('events pushed before the first frame are kept and stamped with the first state drawn', () => {
    const { entities, effects } = layers();
    effects.pushEvents([died(9)]);
    expect(effects.stats().corpses).toBe(1);
    const s = gameState([]);
    entities.update(s, 0, everywhere, 0);
    effects.update(s, 0, everywhere);
    expect(effects.stats().corpses).toBe(1);
    s.tick += CORPSE_TICKS - 1;
    expect(effects.stats().corpses).toBe(1);
  });
});

describe('EntityLayer attack animation', () => {
  it('shows the attack frames over any other state while winding up and through the tail', () => {
    const m = stubManifest();
    const layer = new EntityLayer(m, registry);
    const u = makeUnit(1, 1, 'swordsman', 20, 20, 0);
    const s = gameState([u]);
    layer.update(s, 0, everywhere, 0);
    const idle = layer.drawnTexture(1);
    const atk = (m as { sprite(id: string): SpriteAsset }).sprite('unit.swordsman').animation('attack', 0);
    const W = windupTicksOf(registry.unit('swordsman').combat.windup);
    u.combat.windup = W;
    layer.update(s, 0, everywhere, 0);
    expect((layer as unknown as { units: Map<number, { tex: Texture }> }).units.get(1)!.tex).toBe(atk.frames[0]);
    u.combat.windup = 0;
    u.combat.lastAttackTick = s.tick - 1;
    layer.update(s, 0, everywhere, 0);
    expect((layer as unknown as { units: Map<number, { tex: Texture }> }).units.get(1)!.tex).toBe(atk.frames[5]);
    s.tick += ATTACK_ANIM_TAIL_TICKS;
    layer.update(s, 0, everywhere, 0);
    expect(layer.drawnTexture(1)).toBe(idle);
  });
});

describe('a paused battle is a still picture (redraw on change stays effective)', () => {
  it('keeps the scene signature while the tick and alpha stand still, and changes it as game time moves', () => {
    const { entities, effects } = layers();
    const archer = makeUnit(1, 1, 'archer', 20, 20, 0);
    archer.combat.windup = 4;
    const hurt = makeUnit(2, 2, 'swordsman', 23, 20, 4);
    hurt.lastDamagedTick = 99;
    const house = makeBuilding(3, 2, 'house', 26, 18);
    house.hp = Math.floor(house.builtHp * 0.2);
    const s = gameState([archer, hurt, house]);
    s.projectiles = [makeProjectile(1, 'arrow', { x: 20, y: 20 }, { x: 23, y: 20 }, 8, 4)];
    const root = new Container();
    root.addChild(entities.shadows, effects.decals, entities.container, effects.fx);
    effects.pushEvents([died(9, 21, 21), destroyed(10)]);
    const frame = (alpha: number): number => {
      entities.update(s, alpha, everywhere, (s.tick + alpha) * 50);
      effects.update(s, alpha, everywhere);
      return sceneSignature(root, 1280, 720);
    };
    const still = frame(0.25);
    for (let i = 0; i < 5; i++) expect(frame(0.25)).toBe(still);
    s.tick += 1;
    s.projectiles[0]!.ticksLeft -= 1;
    expect(frame(0.25)).not.toBe(still);
  });
});

describe('draw cost (PLAN-M2 9.4 WP27 acceptance)', () => {
  it('400 units and 100 projectiles cost under 2 ms of JS a frame', () => {
    const { entities, effects } = layers();
    const list: GameState['entities'] = [];
    for (let i = 0; i < 400; i++) {
      const u = makeUnit(i + 1, 1 + (i % 2), i % 3 === 0 ? 'archer' : 'swordsman', 20 + (i % 20) * 0.9, 20 + Math.floor(i / 20) * 0.9, (i % 8) as never, i % 4 === 0 ? 'walk' : 'idle');
      if (i % 5 === 0) u.combat.windup = 3;
      if (i % 7 === 0) u.lastDamagedTick = 99;
      list.push(u);
    }
    for (let i = 0; i < 6; i++) {
      const b = makeBuilding(1000 + i, 1, 'house', 10 + i * 3, 10);
      b.hp = Math.floor(b.builtHp * 0.3);
      list.push(b);
    }
    const s = gameState(list);
    s.projectiles = Array.from({ length: 100 }, (_, i) => makeProjectile(i + 1, i % 10 === 0 ? 'stone' : i % 10 === 1 ? 'fire' : 'arrow', { x: 20 + (i % 20), y: 20 }, { x: 22 + (i % 20), y: 30 }, 20, 1 + (i % 19)));
    const view = { minX: -2000, minY: 0, maxX: 2000, maxY: 2000 };
    const frame = (k: number): void => {
      const a = (k % 10) / 10;
      entities.update(s, a, view, (s.tick + a) * 50);
      effects.update(s, a, view);
    };
    for (let k = 0; k < 60; k++) frame(k); // warm-up (sprites created, JIT)
    const times: number[] = [];
    for (let round = 0; round < 5; round++) {
      const t0 = performance.now();
      for (let k = 0; k < 40; k++) frame(k);
      times.push((performance.now() - t0) / 40);
    }
    times.sort((x, y) => x - y);
    expect(effects.drawnCounts().projectiles).toBe(100);
    // The best of five rounds: a busy machine slows a round, not every round.
    expect(times[0]).toBeLessThan(2);
  });
});
