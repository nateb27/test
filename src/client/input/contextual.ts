/**
 * Contextual right click (plan 7.1) as a pure function: selection + what is
 * under the cursor -> the commands to issue. The sim handlers for gather,
 * build/assist and drop-off may still reject; the commands are issued
 * regardless so no input change is needed when they land.
 *
 * Resolution table (units selected):
 *
 * | target                          | villagers (can gather/build)   | other units |
 * |---------------------------------|--------------------------------|-------------|
 * | ground / unit / other building  | move                           | move        |
 * | resource node                   | gather                         | move        |
 * | own unfinished building         | assist (build)                 | move        |
 * | own completed farm              | gather (on the farm)           | move        |
 * | own drop-off, carrying a load   | dropOff                        | move        |
 *
 * Buildings selected (and no units): own completed production buildings get
 * `setRally` (onto the target when it is a node or farm, else the ground point).
 * Shift sets `queue: true` on move, gather and assist.
 */

import type { DataRegistry, UnitDef } from '../../data/schema';
import type { CommandInput, EntityId, PlayerId, ReadonlyEntity, Vec2 } from '../../sim/types';
import { entityCentre } from './selection';

export type ContextTarget =
  | 'ground'
  | 'node'
  | 'ownUnfinishedBuilding'
  | 'ownFarm'
  | 'ownDropOff'
  | 'otherBuilding'
  | 'unit';

export interface ContextInput {
  /** Selected entities (any owner; foreign ones are ignored). */
  selected: readonly ReadonlyEntity[];
  /** Entity under the cursor, or null for open ground. */
  target: ReadonlyEntity | null;
  /** The clicked ground point in world tiles. */
  point: Vec2;
  shift: boolean;
  owner: PlayerId;
  registry: DataRegistry;
}

/** What the right click landed on. */
export function classifyTarget(target: ReadonlyEntity | null, owner: PlayerId, registry: DataRegistry): ContextTarget {
  if (target === null) return 'ground';
  if (target.kind === 'unit') return 'unit';
  if (target.kind === 'node') return 'node';
  const def = registry.def(target.typeId);
  const bdef = def !== undefined && def.kind === 'building' ? def : null;
  if (target.owner !== owner) return 'otherBuilding';
  if (!target.constructed) return 'ownUnfinishedBuilding';
  if (bdef?.farm !== undefined) return 'ownFarm';
  if (bdef !== null && bdef.dropOff.length > 0) return 'ownDropOff';
  return 'otherBuilding';
}

function unitDef(e: ReadonlyEntity, registry: DataRegistry): UnitDef | null {
  const d = e.kind === 'unit' ? registry.def(e.typeId) : undefined;
  return d !== undefined && d.kind === 'unit' ? d : null;
}

export function resolveContextCommands(input: ContextInput): CommandInput[] {
  const { target, owner, registry } = input;
  const own = input.selected.filter((e) => e.owner === owner);
  const units = own.filter((e) => e.kind === 'unit');
  if (units.length > 0) return unitCommands(units, input, classifyTarget(target, owner, registry));
  return rallyCommands(own, input, classifyTarget(target, owner, registry));
}

function ids(list: readonly ReadonlyEntity[]): EntityId[] {
  return list.map((e) => e.id).sort((a, b) => a - b);
}

function unitCommands(units: readonly ReadonlyEntity[], input: ContextInput, kind: ContextTarget): CommandInput[] {
  const { target, point, shift, registry } = input;
  const out: CommandInput[] = [];
  const handled = new Set<EntityId>();
  const rest = (): ReadonlyEntity[] => units.filter((u) => !handled.has(u.id));
  const take = (list: readonly ReadonlyEntity[]): void => {
    for (const u of list) handled.add(u.id);
  };

  if (target !== null && (kind === 'node' || kind === 'ownFarm')) {
    const def = registry.def(target.typeId);
    const gatherKind = def !== undefined && def.kind === 'node' ? def.gatherKind : def !== undefined && def.kind === 'building' ? def.farm?.gatherKind : undefined;
    const gatherers = units.filter((u) => {
      const ud = unitDef(u, registry);
      return ud?.gather !== undefined && gatherKind !== undefined && ud.gather.rates[gatherKind] !== undefined;
    });
    if (gatherers.length > 0) {
      out.push({ type: 'gather', unitIds: ids(gatherers), nodeId: target.id, queue: shift });
      take(gatherers);
    }
  } else if (target !== null && kind === 'ownUnfinishedBuilding') {
    const builders = units.filter((u) => (unitDef(u, registry)?.builds?.length ?? 0) > 0);
    if (builders.length > 0) {
      out.push({ type: 'assist', unitIds: ids(builders), buildingId: target.id, queue: shift });
      take(builders);
    }
  } else if (target !== null && kind === 'ownDropOff' && target.kind === 'building') {
    const bdef = registry.def(target.typeId);
    const accepted = bdef !== undefined && bdef.kind === 'building' ? bdef.dropOff : [];
    const carriers = units.filter((u) => u.kind === 'unit' && u.carried !== null && accepted.includes(u.carried.type));
    if (carriers.length > 0) {
      out.push({ type: 'dropOff', unitIds: ids(carriers), buildingId: target.id });
      take(carriers);
    }
  }

  const movers = rest();
  if (movers.length > 0) {
    // Moving onto a node or building walks to its footprint centre; the
    // pathfinder takes the unit to the nearest reachable tile.
    const dest = target !== null && target.kind !== 'unit' && kind !== 'otherBuilding' ? entityCentre(target, registry) : point;
    out.push({ type: 'move', unitIds: ids(movers), x: dest.x, y: dest.y, queue: shift });
  }
  return out;
}

function rallyCommands(buildings: readonly ReadonlyEntity[], input: ContextInput, kind: ContextTarget): CommandInput[] {
  const { target, point, registry } = input;
  const producers = buildings.filter((b) => {
    if (b.kind !== 'building' || !b.constructed) return false;
    const d = registry.def(b.typeId);
    return d !== undefined && d.kind === 'building' && d.trains.length > 0;
  });
  if (producers.length === 0) return [];
  if (target !== null && (kind === 'node' || kind === 'ownFarm')) {
    const c = entityCentre(target, registry);
    return [{ type: 'setRally', buildingIds: ids(producers), x: c.x, y: c.y, targetId: target.id }];
  }
  return [{ type: 'setRally', buildingIds: ids(producers), x: point.x, y: point.y }];
}
