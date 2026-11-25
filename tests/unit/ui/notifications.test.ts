import { describe, expect, it } from 'vitest';
import { NotificationCenter } from '../../../src/client/ui/notifications';
import { REJECT_TEXT, formatClock, rejectionText, describeUnavailable } from '../../../src/client/ui/text';
import { createFixture } from '../../../src/client/ui/fixtures';
import { registry } from '../../../src/data';
import type { CommandRejectedEvent, RejectReason, SimEvent, UnavailableReason } from '../../../src/sim/types';

/** Compile-time exhaustive: adding a RejectReason in types.ts breaks this until the test is updated. */
const ALL_REASONS: Record<RejectReason, true> = {
  invalidCommand: true,
  unknownEntity: true,
  notOwner: true,
  cannotPerform: true,
  invalidTarget: true,
  notConstructed: true,
  notAvailable: true,
  cannotAfford: true,
  cannotPlace: true,
  queueFull: true,
  invalidIndex: true,
  unknownDef: true,
};

function setup() {
  let now = 1000;
  const fx = createFixture();
  const center = new NotificationCenter({ registry, playerId: 1, now: () => now });
  return {
    fx,
    center,
    advance: (ms: number) => {
      now += ms;
      return center.tick();
    },
  };
}

function rejected(reason: RejectReason, extra: Partial<CommandRejectedEvent> = {}): SimEvent {
  return { type: 'CommandRejected', playerId: 1, seq: 1, commandType: 'train', reason, ...extra };
}

describe('toast text for rejected commands', () => {
  for (const reason of Object.keys(ALL_REASONS) as RejectReason[]) {
    it(`has plain text for '${reason}'`, () => {
      const { center, fx } = setup();
      center.ingest([rejected(reason)], fx.state);
      const toast = center.toasts[0];
      expect(toast).toBeDefined();
      expect(toast!.kind).toBe('error');
      expect(toast!.text.length).toBeGreaterThan(3);
      expect(toast!.text).not.toBe(reason); // not the raw code
      expect(REJECT_TEXT[reason]).toBeTruthy();
    });
  }

  it('uses the player-facing wording from the plan', () => {
    expect(REJECT_TEXT.cannotPlace).toBe('Cannot build there');
    const { center, fx } = setup();
    center.ingest([rejected('cannotAfford', { shortfall: { food: 0, wood: 25, gold: 0, stone: 0 } })], fx.state);
    expect(center.toasts[0]!.text).toBe('Not enough wood');
  });

  it('names every short resource', () => {
    expect(rejectionText('cannotAfford', { shortfall: { food: 5, wood: 0, gold: 3, stone: 1 } }, registry)).toBe('Not enough food, gold and stone');
    expect(rejectionText('cannotAfford', {}, registry)).toBe('Not enough resources');
  });

  it('explains notAvailable from the first unmet requirement', () => {
    const why: UnavailableReason[] = [{ code: 'requiresAge', age: 2 }];
    expect(rejectionText('notAvailable', { unavailable: why }, registry)).toBe('Requires Township Age');
    expect(rejectionText('notAvailable', {}, registry)).toBe(REJECT_TEXT.notAvailable);
  });

  it('describes every unavailable reason code', () => {
    const reasons: UnavailableReason[] = [
      { code: 'requiresAge', age: 3 },
      { code: 'requiresBuilding', buildingId: 'barracks' },
      { code: 'requiresTech', techId: 'ironAxes' },
      { code: 'wrongCiv' },
      { code: 'replaced', by: 'cataphract' },
      { code: 'buildLimit', limit: 3 },
      { code: 'alreadyResearched' },
      { code: 'researchInProgress' },
      { code: 'ageBuildings', have: 1, need: 2 },
      { code: 'ageAdvanceInProgress' },
    ];
    const texts = reasons.map((r) => describeUnavailable(r, registry));
    expect(texts[0]).toBe('Requires Citadel Age');
    expect(texts[1]).toBe('Requires Barracks');
    expect(texts[2]).toBe('Requires Iron Axes');
    expect(texts[4]).toBe('Replaced by Cataphract');
    expect(texts[5]).toBe('Limit of 3 reached');
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('ignores rejections for other players', () => {
    const { center, fx } = setup();
    center.ingest([{ ...(rejected('cannotPlace') as CommandRejectedEvent), playerId: 2 }], fx.state);
    expect(center.toasts).toEqual([]);
  });
});

describe('other notifications', () => {
  it('population cap says to build houses', () => {
    const { center, fx } = setup();
    center.ingest([{ type: 'PopulationCapped', playerId: 1, buildingId: 1, unitType: 'villager' }], fx.state);
    expect(center.toasts[0]!.text).toBe('Build more houses');
  });

  it('completions, with villager training left quiet', () => {
    const { center, fx } = setup();
    center.ingest(
      [
        { type: 'BuildingCompleted', playerId: 1, buildingId: 9, buildingType: 'mill' },
        { type: 'ResearchCompleted', playerId: 1, techId: 'ironAxes', buildingId: 9 },
        { type: 'UnitTrained', playerId: 1, unitId: 5, unitType: 'villager', buildingId: 1 },
        { type: 'UnitTrained', playerId: 1, unitId: 6, unitType: 'spearman', buildingId: 1 },
      ],
      fx.state,
    );
    expect(center.toasts.map((t) => t.text)).toEqual(['Mill completed', 'Iron Axes researched', 'Spearman trained']);
    expect(center.toasts.every((t) => t.kind === 'success')).toBe(true);
  });

  it('merges idle villager events into one toast', () => {
    const { center, fx } = setup();
    center.ingest([{ type: 'VillagerIdle', playerId: 1, unitId: 3 }], fx.state);
    expect(center.toasts[0]!.text).toBe('A villager is idle');
    const second = setup();
    second.center.ingest(
      [3, 4, 5].map((unitId): SimEvent => ({ type: 'VillagerIdle', playerId: 1, unitId })),
      second.fx.state,
    );
    expect(second.center.toasts.map((t) => t.text)).toEqual(['3 villagers are idle']);
  });

  it('an identical live toast is refreshed, not duplicated', () => {
    const { center, fx, advance } = setup();
    center.ingest([rejected('cannotPlace')], fx.state);
    const first = center.toasts[0]!;
    advance(3000);
    center.ingest([rejected('cannotPlace')], fx.state);
    expect(center.toasts).toHaveLength(1);
    expect(center.toasts[0]!.id).toBe(first.id);
    expect(center.toasts[0]!.expiresAt).toBeGreaterThan(first.expiresAt);
  });

  it('toasts expire and the oldest are dropped past the limit', () => {
    const { center, fx, advance } = setup();
    for (const r of ['cannotPlace', 'queueFull', 'invalidTarget', 'unknownDef', 'notOwner'] as RejectReason[]) {
      center.ingest([rejected(r)], fx.state);
    }
    expect(center.toasts).toHaveLength(4);
    expect(center.toasts[0]!.text).toBe(REJECT_TEXT.queueFull);
    expect(advance(5000)).toBe(true);
    expect(center.toasts).toEqual([]);
  });
});

describe('banners', () => {
  it('age advance shows the new age name', () => {
    const { center, fx } = setup();
    center.ingest([{ type: 'AgeAdvanced', playerId: 1, age: 2 }], fx.state);
    expect(center.banner).toMatchObject({ kind: 'ageAdvanced', title: 'Township Age' });
  });

  it('objective completion shows the elapsed game time', () => {
    const { center, fx } = setup();
    fx.state.objectives.entries.push({ id: 'reachEmpireAge:1', kind: 'reachAge', playerId: 1, targetAge: 4, completedTick: 20 * 1453 });
    center.ingest([{ type: 'ObjectiveCompleted', playerId: 1, objectiveId: 'reachEmpireAge:1', tick: 20 * 1453 }], fx.state);
    expect(center.banner).toMatchObject({ kind: 'objective', title: 'Objective complete' });
    expect(center.banner!.subtitle).toBe(`Empire Age reached after ${formatClock(1453)}`);
    expect(center.banner!.subtitle).toContain('24:13');
  });

  it('queues banners one at a time', () => {
    const { center, fx, advance } = setup();
    center.ingest(
      [
        { type: 'AgeAdvanced', playerId: 1, age: 4 },
        { type: 'ObjectiveCompleted', playerId: 1, objectiveId: 'x', tick: 100 },
      ],
      fx.state,
    );
    expect(center.banner!.kind).toBe('ageAdvanced');
    const firstId = center.banner!.id;
    advance(6000);
    expect(center.banner!.kind).toBe('objective');
    expect(center.banner!.id).toBeGreaterThan(firstId);
    advance(6000);
    expect(center.banner).toBeNull();
  });
});

describe('formatClock', () => {
  it('formats minutes and hours', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(65)).toBe('1:05');
    expect(formatClock(3725)).toBe('1:02:05');
  });
});
