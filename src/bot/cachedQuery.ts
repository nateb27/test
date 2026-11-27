/**
 * A `SimQuery` for one bot decision: answers are those of the wrapped query, `availability` is remembered per
 * (player, id) for the decision, and every call adds its cost to an operation counter (PLAN-M2 6.7 budgets count
 * operations, never milliseconds).
 *
 * Remembering availability changes no answer: the decision only reads the state (its commands apply at the next
 * step), and availability depends on nothing else. The sim's availability check and `canPlace` scan every entity, so
 * a decision that asks about the same unit or tech for every building would otherwise pay that scan each time. The
 * memo is a Map that lives as long as the decision does (never in memory or state).
 */

import type { Availability, BuildingId, DefId, EntityId, PlacementResult, PlayerId, ProducibleId, ReadonlyEntity, SimQuery, StatKey } from '../sim';

export interface OpCounter {
  n: number;
}

export class CachedQuery implements SimQuery {
  private readonly avail = new Map<string, Availability>();

  /** `entityCount`: entities in the state, the cost of one uncached availability check (one `canPlace` costs two). */
  constructor(
    private readonly inner: SimQuery,
    readonly entityCount: number,
    readonly ops: OpCounter,
  ) {}

  entityById(id: EntityId): ReadonlyEntity | undefined {
    this.ops.n++;
    return this.inner.entityById(id);
  }

  entitiesInRect(x0: number, y0: number, x1: number, y1: number): ReadonlyEntity[] {
    this.ops.n += this.entityCount;
    return this.inner.entitiesInRect(x0, y0, x1, y1);
  }

  entityAtPoint(x: number, y: number): ReadonlyEntity | undefined {
    this.ops.n += this.entityCount;
    return this.inner.entityAtPoint(x, y);
  }

  availability(playerId: PlayerId, defId: ProducibleId): Availability {
    const key = `${playerId}:${defId}`;
    const hit = this.avail.get(key);
    if (hit !== undefined) {
      this.ops.n++;
      return hit;
    }
    this.ops.n += this.entityCount;
    const a = this.inner.availability(playerId, defId);
    this.avail.set(key, a);
    return a;
  }

  canPlace(playerId: PlayerId, buildingType: BuildingId, tx: number, ty: number): PlacementResult {
    this.ops.n += 2 * this.entityCount;
    return this.inner.canPlace(playerId, buildingType, tx, ty);
  }

  resolvedStat(playerId: PlayerId, defId: DefId, stat: StatKey): number {
    this.ops.n++;
    return this.inner.resolvedStat(playerId, defId, stat);
  }
}
