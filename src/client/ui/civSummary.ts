/**
 * The civilization select panel's content, generated from the civ data and
 * the defs it lists as uniques (no hand-written text).
 */

import type { Cost, DataRegistry, IconId } from '../../data/schema';
import type { CivId, ProducibleId } from '../../sim/types';
import { RESOURCE_TYPES } from '../../sim/types';
import { formatSeconds } from './text';

export interface CivUniqueVM {
  id: ProducibleId;
  name: string;
  icon: IconId;
  /** e.g. "Unit, Citadel Age, trained at Stable" */
  kind: string;
  /** e.g. "90 food, 80 gold, 34s" */
  stats: string;
  /** e.g. "Replaces Lancer" or null */
  replaces: string | null;
  description: string;
}

export interface CivSummaryVM {
  id: CivId;
  name: string;
  icon: IconId;
  description: string;
  bonuses: { name: string; description: string }[];
  uniques: CivUniqueVM[];
}

function costText(cost: Cost): string {
  const parts = RESOURCE_TYPES.filter((r) => (cost[r] ?? 0) > 0).map((r) => `${cost[r]} ${r}`);
  return parts.length === 0 ? 'free' : parts.join(', ');
}

export function civSummary(civId: CivId, registry: DataRegistry): CivSummaryVM {
  const civ = registry.civ(civId);
  const uniques: CivUniqueVM[] = [];
  for (const id of civ.uniques) {
    const def = registry.producible(id);
    if (def === undefined) continue;
    const age = registry.age(def.age).name;
    let kind: string;
    let time: number;
    if (def.kind === 'unit') {
      const home = registry.buildings.find((b) => b.trains.includes(def.id));
      kind = `Unit, ${age}${home === undefined ? '' : `, trained at ${home.name}`}`;
      time = def.trainTime;
    } else if (def.kind === 'building') {
      kind = `Building, ${age}`;
      time = def.buildTime;
    } else {
      const home = registry.buildings.find((b) => b.researches.includes(def.id));
      kind = `Technology, ${age}${home === undefined ? '' : `, researched at ${home.name}`}`;
      time = def.researchTime;
    }
    const replaced = def.replaces === undefined ? undefined : registry.def(def.replaces);
    uniques.push({
      id,
      name: def.name,
      icon: def.icon,
      kind,
      stats: `${costText(def.cost)}, ${formatSeconds(time)}`,
      replaces: replaced === undefined ? null : `Replaces ${replaced.name}`,
      description: def.description,
    });
  }
  return {
    id: civ.id,
    name: civ.name,
    icon: civ.icon,
    description: civ.description,
    bonuses: civ.bonuses.map((b) => ({ name: b.name, description: b.description })),
    uniques,
  };
}
