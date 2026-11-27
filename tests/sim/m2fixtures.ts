/**
 * The committed v2 save fixture (PLAN-M2 3.6): a 48x48 conquest match "mid-battle", built by hand (no ticks run) so
 * it depends only on entity creation, not on how the combat systems behave. Contents: projectiles in flight, a
 * damaged Barracks with a villager repairing it, a unit at 0 hp (dead this tick), a damaged enemy horseman with an
 * attacker, an UnderAttack alert, and AI controller memory for player 2.
 *
 * Regenerate `tests/sim/fixtures/save-v2.json` (and `save-v1-as-v2.json`) with
 * `UPDATE_SAVE_FIXTURE=1 npx vitest run tests/sim/m2contracts.test.ts` after an intended format change.
 */

import { registry } from '../../src/data';
import { createBuilding, createUnit } from '../../src/sim/entities';
import { createRng } from '../../src/sim/rng';
import { rebuildRuntime } from '../../src/sim/runtime';
import { createInitialState, simFromState } from '../../src/sim/sim';
import { spawnProjectile } from '../../src/sim/systems/projectiles';
import type { ControllerSave, GameConfig, Sim, SimContext } from '../../src/sim';

export const V2_CONFIG: GameConfig = {
  seed: 4242,
  mapSize: 48,
  players: [{ civ: 'byzantines' }, { civ: 'byzantines', difficulty: 'standard' }],
};

export function buildV2Fixture(): { sim: Sim; controllers: ControllerSave[] } {
  const state = createInitialState(V2_CONFIG, registry);
  const ctx: SimContext = { state, runtime: rebuildRuntime(state, registry), data: registry, events: [] };
  state.tick = 3000;

  // Player 1: Town Center, a damaged Barracks under repair, soldiers.
  createBuilding(state, 'townCenter', 1, 4, 4, true);
  const barracks = createBuilding(state, 'barracks', 1, 12, 4, true);
  barracks.hp = 700;
  barracks.lastAttackerId = null;
  barracks.lastDamagedTick = 2950;
  barracks.repairAccumulator = 0.35;
  barracks.repairCostAccumulator = { food: 0, wood: 0.4, gold: 0, stone: 0 };
  const repairer = createUnit(state, 'villager', 1, 11.5, 5.5);
  repairer.currentOrder = { type: 'repair', buildingId: barracks.id, phase: 'repairing' };
  barracks.repairerIds = [repairer.id];
  const archer = createUnit(state, 'archer', 1, 20.5, 20.5, 0);
  archer.stance = 'standGround';
  archer.combat = { cooldown: 12, windup: 0, swingTargetId: null, nextScanTick: 3004, lastAttackTick: 2992 };
  const spear = createUnit(state, 'spearman', 1, 22.5, 22.5, 0);
  spear.currentOrder = { type: 'attackMove', x: 30.5, y: 30.5, phase: 'engaging', targetId: null, anchor: { x: 22, y: 22 }, repathTick: 3005 };
  spear.orderQueue = [{ type: 'hold' }];

  // Player 2: Town Center, a damaged horseman engaging, a dead-this-tick spearman.
  createBuilding(state, 'townCenter', 2, 40, 40, true);
  const horse = createUnit(state, 'horseman', 2, 23.5, 22.5, 4);
  horse.hp = 31;
  horse.lastAttackerId = spear.id;
  horse.lastDamagedTick = 2999;
  horse.currentOrder = { type: 'attack', targetId: spear.id, auto: true, phase: 'attacking', anchor: { x: 25, y: 24 }, repathTick: 3010 };
  horse.combat = { cooldown: 0, windup: 5, swingTargetId: spear.id, nextScanTick: 3007, lastAttackTick: 2964 };
  const dead = createUnit(state, 'spearman', 2, 24.5, 23.5, 3);
  dead.hp = 0;
  dead.lastAttackerId = archer.id;
  dead.lastDamagedTick = 2999;
  state.players[2]!.alert = { tick: 2990, x: 23.5, y: 22.5 };

  // Projectiles in flight: an arrow at the horseman and a Town Center arrow.
  spawnProjectile(ctx, {
    kind: 'arrow', owner: 1, sourceId: archer.id, sourceType: 'archer', targetId: horse.id,
    from: { x: 20.5, y: 20.5 }, to: { x: 23.5, y: 22.5 }, flightTicks: 8, damage: 5,
  });
  spawnProjectile(ctx, {
    kind: 'fire', owner: 2, sourceId: dead.id, sourceType: 'siphonarios', targetId: spear.id,
    from: { x: 24.5, y: 23.5 }, to: { x: 22.5, y: 22.5 }, flightTicks: 6, damage: 10,
  });
  state.projectiles[0]!.ticksLeft = 3;

  const controllers: ControllerSave[] = [
    {
      playerId: 2,
      kind: 'ai',
      difficulty: 'standard',
      memory: { rng: { ...createRng((V2_CONFIG.seed ^ (2 * 0x9e3779b9)) >>> 0) }, seq: 57, phase: 'massing', waveNumber: 0, firstWaveTick: null },
    },
  ];
  return { sim: simFromState(state, registry), controllers };
}
