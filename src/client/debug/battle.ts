/**
 * `__game.startBattle` scene (dev and e2e builds): a two-player conquest map with a large army on each side, two
 * lines facing each other at the map centre, both told to attack-move towards the other. Built only with public sim
 * commands (cheat spawns and `attackMove`), so it works with whatever combat the sim has. A stand-in for the
 * performance scenario of PLAN-M2 8.4 (`createBattleScenario`, WP33), which can replace it without touching callers.
 */

import { registry } from '../../data';
import { createGame } from '../../sim';
import { MAP_SIZE, type Command, type EntityId, type PlayerId, type Sim, type UnitId } from '../../sim/types';

/** Unit mix per 20 soldiers (60/40/40/40/10/10 of 200), front line first. */
const MIX: readonly { type: UnitId; per20: number }[] = [
  { type: 'spearman', per20: 6 },
  { type: 'swordsman', per20: 4 },
  { type: 'horseman', per20: 4 },
  { type: 'cataphract', per20: 1 },
  { type: 'archer', per20: 4 },
  { type: 'siphonarios', per20: 1 },
];

/** Distance between the two lines, in tiles. */
const LINE_GAP = 14;

export function createBattleSim(seed = 1, perSide = 200): Sim {
  const sim = createGame({ seed, mapSize: MAP_SIZE, players: [{ civ: 'byzantines' }, { civ: 'byzantines' }] });
  const blocked = new Set<number>();
  for (const e of sim.state.entities) {
    if (e.kind === 'unit') continue;
    const def = registry.def(e.typeId);
    const size = def !== undefined && (def.kind === 'building' || def.kind === 'node') ? def.footprint : 1;
    for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) blocked.add((e.tile.ty + dy) * MAP_SIZE + e.tile.tx + dx);
  }
  const centre = Math.floor(MAP_SIZE / 2);

  const counts = MIX.map((m) => Math.floor((perSide * m.per20) / 20));
  counts[0] = (counts[0] ?? 0) + perSide - counts.reduce((a, b) => a + b, 0);
  const order: UnitId[] = MIX.flatMap((m, i) => Array.from({ length: counts[i] ?? 0 }, () => m.type));

  let seq = 1;
  const spawns: Command[] = [];
  for (const side of [1, 2] as const) {
    // Rows run away from the middle: side 1 above it (smaller y), side 2 below it.
    const dir = side === 1 ? -1 : 1;
    let placed = 0;
    for (let row = 0; placed < order.length && row < MAP_SIZE; row++) {
      const ty = centre + dir * (LINE_GAP / 2 + row);
      for (let k = 0; placed < order.length && k < MAP_SIZE; k++) {
        const tx = centre + (k % 2 === 0 ? k / 2 : -(k + 1) / 2);
        if (tx < 1 || tx >= MAP_SIZE - 1 || ty < 1 || ty >= MAP_SIZE - 1 || blocked.has(ty * MAP_SIZE + tx)) continue;
        spawns.push({
          type: 'cheat',
          playerId: 1,
          seq: seq++,
          cheat: { kind: 'spawnUnit', unitType: order[placed]!, x: tx + 0.5, y: ty + 0.5, owner: side },
        });
        placed++;
      }
    }
  }
  sim.step(spawns);

  const ids: Record<PlayerId, EntityId[]> = { 0: [], 1: [], 2: [] };
  for (const e of sim.state.entities) if (e.kind === 'unit' && e.owner >= 1 && e.owner <= 2 && e.typeId !== 'villager') ids[e.owner]!.push(e.id);
  const orders: Command[] = ([1, 2] as const).map((side) => ({
    type: 'attackMove',
    playerId: side,
    seq: side === 1 ? seq++ : 1,
    unitIds: ids[side]!,
    x: centre + 0.5,
    y: centre + (side === 1 ? 1 : -1) * (LINE_GAP / 2) + 0.5,
    queue: false,
  }));
  sim.step(orders);
  return sim;
}
