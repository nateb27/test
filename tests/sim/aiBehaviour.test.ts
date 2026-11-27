/**
 * AI behaviours (PLAN-M2 6.6): defence (reaction delay, defenders, villager handling per difficulty), repair and
 * rebuild. Short scripted scenarios: the test issues cheats (as the idle player 2, or as player 1 with seq 0 for
 * resources) to create the situation; the AI under test never issues cheats itself.
 */

import { describe, expect, it } from 'vitest';
import { AiPlayer } from '../../src/bot';
import {
  TICK_RATE,
  createGame,
  type AiDifficulty,
  type BuildingEntity,
  type CheatAction,
  type Command,
  type PlayerId,
  type ReadonlyEntity,
  type Sim,
  type UnitEntity,
} from '../../src/sim';
import { matchConfig } from './aiHarness';

class Scenario {
  readonly sim: Sim;
  readonly ai: AiPlayer;
  private pending: Command[] = [];
  private seq = 1;
  rejected: string[] = [];

  constructor(diff: AiDifficulty, seed = 1) {
    this.sim = createGame(matchConfig(seed, [diff, 'idle']));
    this.ai = AiPlayer.create(1, diff, seed);
  }

  cheat(cheat: CheatAction, as: PlayerId = 2): void {
    this.pending.push({ type: 'cheat', cheat, playerId: as, seq: as === 1 ? 0 : this.seq++ } as Command);
  }

  run(ticks: number, onTick?: () => void): void {
    for (let i = 0; i < ticks; i++) {
      const cmds = [...this.ai.update(this.sim), ...this.pending];
      this.pending = [];
      for (const e of this.sim.step(cmds)) {
        if (e.type === 'CommandRejected' && e.playerId === 1) this.rejected.push(`${e.commandType}:${e.reason}`);
      }
      onTick?.();
    }
  }

  get tc(): Readonly<BuildingEntity> {
    return this.sim.state.entities.find((e) => e.kind === 'building' && e.owner === 1 && e.typeId === 'townCenter') as BuildingEntity;
  }

  units(owner: PlayerId, type?: string): Readonly<UnitEntity>[] {
    return this.sim.state.entities.filter(
      (e): e is UnitEntity => e.kind === 'unit' && e.owner === owner && (type === undefined || e.typeId === type),
    );
  }

  buildings(type: string): Readonly<BuildingEntity>[] {
    return this.sim.state.entities.filter((e): e is BuildingEntity => e.kind === 'building' && e.owner === 1 && e.typeId === type);
  }

  /** A free tile centre about `d` tiles from the Town Center towards the map centre, nudged off anything solid. */
  spot(d: number, side = 0): { x: number; y: number } {
    const tc = this.tc;
    const cx = tc.tile.tx + 2;
    const cy = tc.tile.ty + 2;
    const w = this.sim.state.map.width;
    const sx = cx < w / 2 ? 1 : -1;
    for (let k = 0; k < 40; k++) {
      const x = Math.floor(cx + sx * (d + (k % 5))) + 0.5;
      const y = Math.floor(cy + sx * (side + Math.floor(k / 5))) + 0.5;
      const hit: ReadonlyEntity | undefined = this.sim.state.entities.find(
        (e) => e.kind !== 'unit' && x >= e.tile.tx && y >= e.tile.ty && x < e.tile.tx + 4 && y < e.tile.ty + 4,
      );
      if (hit === undefined) return { x, y };
    }
    return { x: cx + sx * d, y: cy };
  }

  spawn(type: string, owner: PlayerId, n: number, at: { x: number; y: number }): void {
    for (let i = 0; i < n; i++) this.cheat({ kind: 'spawnUnit', unitType: type, x: at.x + (i % 3) * 0.6, y: at.y + Math.floor(i / 3) * 0.6, owner });
  }
}

const SEC = TICK_RATE;

describe('defence (6.6)', () => {
  it('standard: answers a raid after its reaction delay with every fighting unit and evacuates nearby villagers', () => {
    const s = new Scenario('standard');
    s.spawn('spearman', 1, 6, s.spot(3, -3));
    s.run(5 * SEC);
    // Raiders right next to the villagers working near the Town Center.
    s.spawn('horseman', 2, 3, s.spot(5, 2));
    let firstOrderTick: number | null = null;
    const raidTick = s.sim.state.tick + 1;
    s.run(8 * SEC, () => {
      if (firstOrderTick !== null) return;
      if (s.units(1, 'spearman').some((u) => u.currentOrder !== null && (u.currentOrder.type === 'attackMove' || u.currentOrder.type === 'attack'))) {
        firstOrderTick = s.sim.state.tick;
      }
    });
    expect(firstOrderTick, 'defenders ordered').not.toBeNull();
    expect(firstOrderTick! - raidTick).toBeGreaterThanOrEqual(3 * SEC);
    expect(firstOrderTick! - raidTick).toBeLessThanOrEqual(3 * SEC + 2 * 20 + 2);
    expect(s.ai.memory.defence.active).toBe(true);
    expect(s.ai.memory.defence.villagerIds.length, 'villagers evacuated').toBeGreaterThan(0);
    // Six spearmen kill three horsemen; the threat clears and the villagers go back to work.
    s.run(60 * SEC);
    expect(s.units(2, 'horseman')).toEqual([]);
    expect(s.ai.memory.defence.active).toBe(false);
    expect(s.ai.memory.defence.villagerIds).toEqual([]);
    s.run(10 * SEC);
    const idle = s.units(1, 'villager').filter((v) => v.currentOrder === null);
    expect(idle.length).toBeLessThanOrEqual(1);
    expect(s.rejected).toEqual([]);
  });

  it('hard: the 4 nearest villagers fight a raid of at most 2 units', () => {
    const s = new Scenario('hard');
    s.run(2 * SEC);
    s.spawn('spearman', 2, 1, s.spot(4, 1));
    s.run(4 * SEC);
    const fighters = s.units(1, 'villager').filter((v) => v.currentOrder?.type === 'attack');
    expect(fighters.length).toBe(4);
    expect(s.ai.memory.defence.villagerIds.length).toBe(4);
    s.run(40 * SEC);
    expect(s.units(2, 'spearman')).toEqual([]);
    expect(s.rejected).toEqual([]);
  });

  it('easy: defends with military only, after 10 s, and leaves its villagers alone', () => {
    const s = new Scenario('easy');
    // Far enough from the raid that they do not acquire it on their own.
    s.spawn('spearman', 1, 4, s.spot(-7, -2));
    s.run(4 * SEC);
    s.spawn('horseman', 2, 2, s.spot(5, 2));
    const raidTick = s.sim.state.tick + 1;
    let firstOrderTick: number | null = null;
    s.run(15 * SEC, () => {
      if (firstOrderTick === null && s.units(1, 'spearman').some((u) => u.currentOrder?.type === 'attackMove')) firstOrderTick = s.sim.state.tick;
    });
    expect(firstOrderTick).not.toBeNull();
    expect(firstOrderTick! - raidTick).toBeGreaterThanOrEqual(10 * SEC);
    expect(s.ai.memory.defence.villagerIds).toEqual([]);
  });
});

describe('repair (6.6)', () => {
  it('standard: a Town Center below 70% with no enemy near gets 4 repairers and recovers', () => {
    const s = new Scenario('standard');
    s.run(10 * SEC);
    s.cheat({ kind: 'addResources', amounts: { wood: 500, stone: 300 } }, 1);
    s.cheat({ kind: 'setHp', entityId: s.tc.id, hp: 900 });
    let most = 0;
    s.run(30 * SEC, () => {
      most = Math.max(most, s.units(1, 'villager').filter((v) => v.currentOrder?.type === 'repair').length);
    });
    // Builders busy on the opening Houses and camps join as they come free; never more than 4.
    expect(most).toBe(4);
    expect(s.tc.hp).toBeGreaterThan(900);
    expect(s.rejected).toEqual([]);
  });

  it('easy never repairs', () => {
    const s = new Scenario('easy');
    s.run(10 * SEC);
    s.cheat({ kind: 'setHp', entityId: s.tc.id, hp: 900 });
    s.run(10 * SEC);
    expect(s.units(1, 'villager').filter((v) => v.currentOrder?.type === 'repair')).toEqual([]);
  });

  it('does not repair while an enemy is within 8 tiles', () => {
    const s = new Scenario('standard');
    s.run(5 * SEC);
    s.spawn('batteringRam', 2, 1, s.spot(4, 0));
    s.cheat({ kind: 'setHp', entityId: s.tc.id, hp: 900 });
    s.run(4 * SEC);
    expect(s.units(1, 'villager').filter((v) => v.currentOrder?.type === 'repair')).toEqual([]);
  });
});

describe('rebuild (6.6)', () => {
  it('a lost Town Center is re-placed first once the AI has a villager and the stone', () => {
    const s = new Scenario('standard');
    s.run(30 * SEC);
    s.cheat({ kind: 'addResources', amounts: { wood: 400, stone: 150 } }, 1);
    s.cheat({ kind: 'setHp', entityId: s.tc.id, hp: 0 });
    s.run(3 * SEC);
    expect(s.buildings('townCenter').length, 'Town Center foundation').toBe(1);
    expect(s.buildings('townCenter')[0]!.constructed).toBe(false);
    expect(s.rejected).toEqual([]);
  });

  it('standard re-places a destroyed Barracks', () => {
    const s = new Scenario('standard');
    s.cheat({ kind: 'instantBuild', enabled: true }, 1);
    s.cheat({ kind: 'addResources', amounts: { food: 2000, wood: 2000 } }, 1);
    let tick = 0;
    while (s.buildings('barracks').filter((b) => b.constructed).length === 0 && tick < 8 * 60 * SEC) {
      s.run(SEC);
      tick += SEC;
    }
    const barracks = s.buildings('barracks')[0]!;
    expect(barracks.constructed).toBe(true);
    s.run(2 * SEC);
    s.cheat({ kind: 'setHp', entityId: barracks.id, hp: 0 });
    s.run(5 * SEC);
    const again = s.buildings('barracks');
    expect(again.length).toBe(1);
    expect(again[0]!.id).not.toBe(barracks.id);
    expect(s.rejected).toEqual([]);
  });
});
