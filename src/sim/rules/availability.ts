/** Availability rules (plan 4.7). Owned by WP8. */

import { resolvedCost } from './stats';
import type { ProducibleDef } from '../../data/schema';
import {
  RESOURCE_TYPES,
  type Availability,
  type BuildingId,
  type PlayerId,
  type ProducibleId,
  type ResourceAmounts,
  type SimContext,
  type UnavailableReason,
} from '../types';

const ZERO: ResourceAmounts = { food: 0, wood: 0, gold: 0, stone: 0 };

/** The def that replaces `defId` for a civ, if any (its `replaces` is `defId` and the civ may have it). */
function replacerFor(ctx: SimContext, defId: ProducibleId, civ: string | null): ProducibleId | null {
  const all: ProducibleDef[] = [...ctx.data.units, ...ctx.data.buildings, ...ctx.data.techs];
  for (const d of all) {
    if (d.replaces === defId && (d.civs === undefined || (civ !== null && d.civs.includes(civ)))) return d.id;
  }
  return null;
}

/** Distinct completed building types of the given age that count toward an age advance. */
export function countAgeBuildings(ctx: SimContext, playerId: PlayerId, age: number): number {
  const seen = new Set<BuildingId>();
  for (const e of ctx.state.entities) {
    if (e.kind !== 'building' || e.owner !== playerId || !e.constructed) continue;
    const def = ctx.data.building(e.typeId);
    if (def.countsTowardAge && def.age === age) seen.add(e.typeId);
  }
  return seen.size;
}

/**
 * Whether `defId` (unit, building or tech) is available to the player: age,
 * requiresBuildings, requiresTechs, civs, replaces, buildLimit, already
 * researched / in progress, age-advance building count; plus resolved cost and
 * affordability. The sim's validation and the HUD both call this.
 *
 * Unknown ids are reported as unavailable and hidden with no reasons.
 */
export function availability(ctx: SimContext, playerId: PlayerId, defId: ProducibleId): Availability {
  const def = ctx.data.producible(defId);
  const player = ctx.state.players[playerId];
  if (def === undefined || player === undefined) {
    return { available: false, hidden: true, reasons: [], cost: { ...ZERO }, affordable: false, shortfall: { ...ZERO } };
  }
  const cost = resolvedCost(ctx, playerId, defId);
  const shortfall: ResourceAmounts = { ...ZERO };
  let affordable = true;
  for (const r of RESOURCE_TYPES) {
    shortfall[r] = Math.max(0, cost[r] - player.resources[r]);
    if (shortfall[r] > 0) affordable = false;
  }
  const finish = (reasons: UnavailableReason[], hidden: boolean): Availability => ({
    available: reasons.length === 0 && !hidden,
    hidden,
    reasons,
    cost,
    affordable,
    shortfall,
  });

  if (def.civs !== undefined && (player.civ === null || !def.civs.includes(player.civ))) {
    return finish([{ code: 'wrongCiv' }], true);
  }
  const replacer = replacerFor(ctx, defId, player.civ);
  if (replacer !== null) return finish([{ code: 'replaced', by: replacer }], true);

  if (def.kind === 'tech' && player.researched.includes(def.id)) {
    return finish([{ code: 'alreadyResearched' }], false);
  }

  const reasons: UnavailableReason[] = [];
  if (player.age < def.age) reasons.push({ code: 'requiresAge', age: def.age });

  const owned = new Set<BuildingId>();
  const queuedTechs = new Set<string>();
  let ownedOfType = 0;
  for (const e of ctx.state.entities) {
    if (e.kind !== 'building' || e.owner !== playerId) continue;
    if (e.constructed) owned.add(e.typeId);
    if (e.typeId === defId) ownedOfType += 1;
    for (const item of e.queue) if (item.kind === 'tech') queuedTechs.add(item.techId);
  }
  for (const b of def.requiresBuildings ?? []) {
    if (!owned.has(b)) reasons.push({ code: 'requiresBuilding', buildingId: b });
  }
  for (const t of def.requiresTechs ?? []) {
    if (!player.researched.includes(t)) reasons.push({ code: 'requiresTech', techId: t });
  }

  if (def.kind === 'building' && def.buildLimit !== undefined && ownedOfType >= def.buildLimit) {
    reasons.push({ code: 'buildLimit', limit: def.buildLimit });
  }

  if (def.kind === 'tech') {
    if (def.advancesTo !== undefined) {
      if (def.requiresAgeBuildings !== undefined && player.age >= def.age) {
        const have = countAgeBuildings(ctx, playerId, player.age);
        if (have < def.requiresAgeBuildings) {
          reasons.push({ code: 'ageBuildings', have, need: def.requiresAgeBuildings });
        }
      }
      for (const t of queuedTechs) {
        const td = ctx.data.def(t);
        if (td !== undefined && td.kind === 'tech' && td.advancesTo !== undefined) {
          reasons.push({ code: 'ageAdvanceInProgress' });
          break;
        }
      }
    } else if (queuedTechs.has(def.id)) {
      reasons.push({ code: 'researchInProgress' });
    }
  }
  return finish(reasons, false);
}
