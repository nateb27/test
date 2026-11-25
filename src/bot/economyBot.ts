/**
 * The scripted economy bot. It plays the reference build order through the public sim API only:
 *
 *   1. read   `readView(sim, playerId)`   what the player can see (state and queries)
 *   2. decide `decide(view, query, data)` pure function from the view to commands (no sim access beyond queries)
 *   3. emit   `EconomyBot.update(sim)`    stamps the commands; the caller passes them to `sim.step`
 *
 * It decides once per game second, never per tick, and never uses cheats. The same shape (read, decide,
 * emit, with the decision split into small priority-ordered rules) is what a future AI player extends.
 *
 * The decision rules, in priority order each second:
 *   houses ahead of the cap, Town Center production (villagers without idle time, age advances), the two
 *   buildings each age needs, assignment of idle villagers by the age's resource shares (camps, mills and
 *   farms are built on demand next to the resource), rebalancing, economy technologies, Silk Workshops.
 */

import { registry } from '../data';
import type { DataRegistry } from '../data';
import type { BuildingId, Command, CommandInput, EntityId, PlayerId, ResourceAmounts, ResourceType, Sim, SimQuery } from '../sim';
import { blockedFromView, findSpot, floodReach, ringReachable, solidFromView } from './placement';
import type { Blocked } from './placement';
import { PLAN } from './plan';
import { readView, type BotView, type BuildingView, type NodeView, type VillagerView } from './view';

const RESOURCES: readonly ResourceType[] = ['food', 'wood', 'gold', 'stone'];

/** Camp type that serves a resource, and the node slots that count as that resource there. */
const CAMP_FOR: Record<ResourceType, BuildingId> = {
  food: 'mill',
  wood: 'lumberCamp',
  gold: 'miningCamp',
  stone: 'miningCamp',
};

const dist = (ax: number, ay: number, bx: number, by: number): number => Math.sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by));

export class EconomyBot {
  private seq = 1;
  /** Decisions made so far (for tests and debugging). */
  decisions = 0;

  constructor(
    readonly playerId: PlayerId,
    private readonly data: DataRegistry = registry,
  ) {}

  /** Call before every `sim.step`; returns the commands to pass to it (empty except once a second). */
  update(sim: Sim): Command[] {
    if (sim.state.tick % PLAN.decisionIntervalTicks !== 0) return [];
    this.decisions++;
    const view = readView(sim, this.playerId, this.data);
    const inputs = decide(view, sim.query, this.data);
    return inputs.map((input) => ({ ...input, playerId: this.playerId, seq: this.seq++ }) as Command);
  }
}

/** One decision: a pure function of the view and read-only queries. */
export function decide(view: BotView, query: SimQuery, data: DataRegistry = registry): CommandInput[] {
  return new Decision(view, query, data).run();
}

class Decision {
  private readonly cmds: CommandInput[] = [];
  private readonly budget: ResourceAmounts;
  private readonly blocked: Blocked;
  /** Tiles units cannot enter, and the walkable tiles reachable from the Town Center (computed on demand). */
  private readonly solid: Blocked;
  private reach: Uint8Array | null = null;
  private popUsed: number;
  /** Resources set aside for a purchase the bot is saving for; only that purchase may spend them. */
  private reserved: ResourceAmounts = { food: 0, wood: 0, gold: 0, stone: 0 };
  private readonly tc: BuildingView | undefined;
  private readonly tcCentre: { x: number; y: number };
  /** Gatherer counts per resource, kept current as villagers are assigned. */
  private readonly counts: Record<ResourceType, number> = { food: 0, wood: 0, gold: 0, stone: 0 };

  constructor(
    private readonly view: BotView,
    private readonly query: SimQuery,
    private readonly data: DataRegistry,
  ) {
    this.budget = { ...view.resources };
    this.blocked = blockedFromView(view);
    this.solid = solidFromView(view);
    this.popUsed = view.popUsed;
    this.tc = view.buildings.find((b) => b.typeId === 'townCenter' && b.constructed);
    this.tcCentre = this.tc !== undefined ? { x: this.tc.cx, y: this.tc.cy } : { x: view.mapWidth / 2, y: view.mapHeight / 2 };
    for (const v of view.villagers) {
      const r = this.resourceOf(v);
      if (r !== null) this.counts[r]++;
    }
  }

  run(): CommandInput[] {
    if (this.tc === undefined) return this.cmds;
    this.houses();
    this.ageUp();
    this.production();
    this.ageBuildings();
    this.assignIdle();
    this.retargetFar();
    this.rebalance();
    this.techs();
    this.extraSilkWorkshops();
    return this.cmds;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private cost(id: string): ResourceAmounts {
    return this.query.availability(this.view.playerId, id).cost;
  }

  /** Can `cost` be paid without touching what earlier rules reserved this decision (and `extra`)? */
  private affordable(cost: ResourceAmounts, extra?: ResourceAmounts): boolean {
    return RESOURCES.every((r) => this.budget[r] - this.reserved[r] - (extra?.[r] ?? 0) >= cost[r]);
  }

  /** Can `cost` be paid, ignoring reservations? Used by the rules that own the reservations. */
  private affordableNow(cost: ResourceAmounts): boolean {
    return RESOURCES.every((r) => this.budget[r] >= cost[r]);
  }

  private pay(cost: ResourceAmounts): void {
    for (const r of RESOURCES) this.budget[r] -= cost[r];
  }

  private available(id: string): boolean {
    return this.query.availability(this.view.playerId, id).available;
  }

  private emit(cmd: CommandInput): void {
    this.cmds.push(cmd);
  }

  private ofType(type: string, constructedOnly = false): BuildingView[] {
    return this.view.buildings.filter((b) => b.typeId === type && (!constructedOnly || b.constructed));
  }

  /** The resource a villager is (about to be) working on, or null. Builders of camps and farms count for what they will gather. */
  private resourceOf(v: VillagerView): ResourceType | null {
    const t = v.task;
    if (t.kind === 'gather') return t.resource;
    if (t.kind === 'build') {
      const b = this.view.buildings.find((x) => x.id === t.buildingId);
      if (b === undefined) return null;
      if (b.typeId === 'lumberCamp') return 'wood';
      if (b.typeId === 'mill' || b.typeId === 'farm') return 'food';
      if (b.typeId === 'miningCamp') return 'gold';
    }
    return null;
  }

  private claim(v: VillagerView, resource: ResourceType | null): void {
    const before = this.resourceOf(v);
    if (before !== null) this.counts[before]--;
    v.claimed = true;
    if (resource !== null) this.counts[resource]++;
  }

  /** Foundation or completed drop-offs for a resource (the Town Center takes everything). */
  private dropOffs(resource: ResourceType): BuildingView[] {
    return this.view.buildings.filter((b) => b.dropOff.includes(resource));
  }

  /** Walking gap between a node and the nearest drop-off for it, planned ones included. */
  private dropDistance(n: NodeView): number {
    let best = Infinity;
    for (const d of this.dropOffs(n.resource)) {
      best = Math.min(best, Math.max(0, dist(n.cx, n.cy, d.cx, d.cy) - d.size / 2 - n.size / 2));
    }
    return best;
  }

  /** Register a building the decision just ordered so later rules see it. */
  private registerSite(type: BuildingId, tx: number, ty: number, builders: number): void {
    const size = this.data.building(type).footprint;
    this.blocked.mark(tx, ty, size);
    if (type !== 'farm') {
      this.solid.mark(tx, ty, size);
      this.reach = null;
    }
    this.view.buildings.push({
      id: -1,
      typeId: type,
      tx,
      ty,
      size,
      cx: tx + size / 2,
      cy: ty + size / 2,
      constructed: false,
      builders,
      queueLength: 0,
      queuedTechs: [],
      dropOff: this.data.building(type).dropOff,
    });
  }

  /** Villagers best placed to build at (cx, cy): idle first, then wood cutters, nearest, empty-handed. */
  private pickBuilders(cx: number, cy: number, count: number, only?: (v: VillagerView) => boolean): VillagerView[] {
    const scored: { v: VillagerView; score: number }[] = [];
    for (const v of this.view.villagers) {
      if (v.claimed || v.task.kind === 'build' || v.task.kind === 'busy') continue;
      if (only !== undefined && !only(v)) continue;
      let score = dist(v.x, v.y, cx, cy);
      if (v.task.kind === 'idle') score -= 4;
      else {
        if (v.carried > 0) score += 5;
        if (v.task.slot === 'gold' || v.task.slot === 'stone') score += 8;
        if (v.task.slot === 'berries' || v.task.slot === 'farm') score += 4;
      }
      scored.push({ v, score });
    }
    scored.sort((a, b) => a.score - b.score || a.v.id - b.v.id);
    return scored.slice(0, count).map((s) => s.v);
  }

  /** Order a building: pick the site, builders and pay. Returns the builders or null if nothing was ordered. */
  private construct(
    type: BuildingId,
    spot: { tx: number; ty: number } | null,
    builders: VillagerView[],
    priority = false,
  ): VillagerView[] | null {
    if (spot === null || builders.length === 0) return null;
    const cost = this.cost(type);
    if (!(priority ? this.affordableNow(cost) : this.affordable(cost))) return null;
    this.pay(cost);
    this.emit({ type: 'build', unitIds: builders.map((b) => b.id), buildingType: type, tx: spot.tx, ty: spot.ty, queue: false });
    this.registerSite(type, spot.tx, spot.ty, builders.length);
    const resource = type === 'lumberCamp' ? 'wood' : type === 'mill' || type === 'farm' ? 'food' : type === 'miningCamp' ? 'gold' : null;
    for (const b of builders) this.claim(b, resource);
    return builders;
  }

  private env() {
    return { view: this.view, query: this.query, data: this.data, playerId: this.view.playerId, blocked: this.blocked };
  }

  /** A site for a large building or House: near the Town Center, outside the farm ring, with a free lane around it. */
  private baseSpot(type: BuildingId, minDist: number): { tx: number; ty: number } | null {
    const { x, y } = this.tcCentre;
    return findSpot(this.env(), {
      type,
      near: { x, y },
      maxDist: 22,
      gap: 1,
      score: (cx, cy) => {
        const d = dist(cx, cy, x, y);
        return d < minDist ? Infinity : d;
      },
    });
  }

  // -------------------------------------------------------------------------
  // Rules
  // -------------------------------------------------------------------------

  /** Houses ahead of the population cap. */
  private houses(): void {
    const inFlight = this.ofType('house').filter((h) => !h.constructed).length;
    const futureCap = Math.min(200, this.view.popCap + inFlight * 10);
    if (futureCap >= 200 || futureCap - this.popUsed >= PLAN.houseMargin || inFlight >= 2) return;
    if (!this.affordableNow(this.cost('house'))) return;
    const spot = this.baseSpot('house', 7);
    if (spot === null) return;
    const builders = this.pickBuilders(spot.tx + 1, spot.ty + 1, PLAN.houseBuilders);
    this.construct('house', spot, builders, true);
  }

  /** Reserve for the next age advance, or zeros when there is none or its buildings are missing. */
  private ageUpCost(): ResourceAmounts | null {
    const next = this.view.age + 1;
    if (next > 4) return null;
    const tech = this.data.age(next as 2 | 3 | 4).advanceTech;
    if (tech === null) return null;
    return this.cost(tech);
  }

  private ageUpAvailable(): string | null {
    const next = this.view.age + 1;
    if (next > 4) return null;
    const tech = this.data.age(next as 2 | 3 | 4).advanceTech;
    if (tech === null) return null;
    return this.available(tech) ? tech : null;
  }

  /** Villagers without idle Town Center time; waits briefly for the age advance when it is nearly affordable. */
  private production(): void {
    const tc = this.tc;
    if (tc === undefined || tc.queuedTechs.length > 0) return;
    const ageTech = this.ageUpAvailable();
    const ageCost = ageTech !== null ? this.cost(ageTech) : null;
    let queued = tc.queueLength;
    const villagers = this.view.villagers.length + queued;
    const unitCost = this.cost('villager');
    let n = villagers;
    while (queued < PLAN.tcQueueDepth && n < PLAN.villagerTarget && this.popUsed < this.view.popCap) {
      // Age advance is ready except for food: stop feeding the queue so the advance goes in at once.
      if (ageCost !== null && queued >= 1 && this.budget.food - unitCost.food < ageCost.food) break;
      if (ageCost !== null && this.budget.food < ageCost.food) {
        const wait = this.counts.food * PLAN.foodPerGatherer * (PLAN.holdSeconds[this.view.age] ?? 0);
        if (ageCost.food - this.budget.food <= wait) break;
      }
      if (!this.affordableNow(unitCost)) break;
      this.pay(unitCost);
      this.popUsed++;
      this.emit({ type: 'train', buildingId: tc.id, unitType: 'villager' });
      queued++;
      n++;
    }
  }

  /** Research the next age as soon as it can be paid. */
  private ageUp(): void {
    const tc = this.tc;
    const tech = this.ageUpAvailable();
    if (tc === undefined || tech === null) return;
    const cost = this.cost(tech);
    if (!this.affordableNow(cost)) return;
    // Waiting villagers would delay it by a full training time: take back the one that has not started.
    if (tc.queueLength >= 2) {
      this.emit({ type: 'cancelQueue', buildingId: tc.id, index: tc.queueLength - 1 });
      this.budget.food += this.cost('villager').food;
      this.popUsed--;
    }
    this.pay(cost);
    this.emit({ type: 'research', buildingId: tc.id, techId: tech });
  }

  /**
   * The two buildings of the current age the next advance asks for. Started once enough food is banked
   * toward the advance that they will be standing by the time it is affordable; their cost is then reserved
   * so farms and techs do not eat the wood.
   */
  private ageBuildings(): void {
    const wanted = PLAN.ageBuildings[this.view.age];
    const ageCost = this.ageUpCost();
    if (wanted === undefined || ageCost === null) return;
    if (this.view.resources.food < ageCost.food * PLAN.ageBuildingsFoodShare) return;
    for (const type of wanted) {
      if (this.ofType(type).length > 0) continue;
      if (!this.available(type)) continue;
      const cost = this.cost(type);
      if (!this.affordableNow(cost)) {
        this.reserved = cost;
        return;
      }
      const spot = this.baseSpot(type, 8);
      const size = this.data.building(type).footprint;
      const builders = spot === null ? [] : this.pickBuilders(spot.tx + size / 2, spot.ty + size / 2, PLAN.bigBuilders);
      this.construct(type, spot, builders, true);
      return;
    }
  }

  /** More Silk Workshops (gold with no workers) once the age's own buildings stand and stone is spare. */
  private extraSilkWorkshops(): void {
    if (this.view.age < 3 || !this.available('silkWorkshop')) return;
    const have = this.ofType('silkWorkshop').length;
    if (have === 0 || have >= PLAN.maxSilkWorkshops || this.ofType('silkWorkshop').some((b) => !b.constructed)) return;
    if (this.ofType('siegeWorkshop').length === 0) return;
    const reserve = this.view.age < 4 ? (this.ageUpCost() ?? undefined) : undefined;
    const cost = this.cost('silkWorkshop');
    if (!this.affordable(cost, reserve)) return;
    const spot = this.baseSpot('silkWorkshop', 8);
    const builders = spot === null ? [] : this.pickBuilders(spot.tx + 1.5, spot.ty + 1.5, PLAN.bigBuilders);
    this.construct('silkWorkshop', spot, builders);
  }

  // -------------------------------------------------------------------------
  // Allocation
  // -------------------------------------------------------------------------

  private deficits(): { resource: ResourceType; deficit: number }[] {
    const shares = PLAN.shares[this.view.age] ?? PLAN.shares[4]!;
    const total = this.view.villagers.length;
    return RESOURCES.map((resource) => ({
      resource,
      deficit: total * shares[resource] - this.counts[resource] + this.pressure(resource),
    }));
  }

  /**
   * Stockpile feedback on the age's fixed shares, in villagers: a starved wood stockpile pulls workers in
   * (farms, houses and buildings all need it), a pile beyond what the next purchases need sends them away.
   */
  private pressure(resource: ResourceType): number {
    const stock = this.view.resources[resource];
    if (resource === 'food') return 0;
    if (resource === 'wood' && stock - this.reserved.wood < PLAN.woodLow) return Math.min(5, (PLAN.woodLow + this.reserved.wood - stock) / 40);
    const ageCost = this.ageUpCost();
    const high = Math.max(PLAN.stockHigh[resource], (ageCost?.[resource] ?? 0) + PLAN.stockHeadroom);
    return stock > high ? -Math.min(3, (stock - high) / 100) : 0;
  }

  private hasNodes(resource: ResourceType): boolean {
    if (resource === 'food') return true; // berries or farms
    return this.view.nodes.some((n) => n.resource === resource && n.gatherers < n.maxGatherers);
  }

  private assignIdle(): void {
    const idle = this.view.villagers.filter((v) => v.task.kind === 'idle' && !v.claimed);
    for (const v of idle) {
      const order = this.deficits()
        .filter((d) => this.hasNodes(d.resource))
        .sort((a, b) => b.deficit - a.deficit || RESOURCES.indexOf(a.resource) - RESOURCES.indexOf(b.resource));
      for (const d of order) {
        if (this.assign(v, d.resource)) break;
      }
    }
  }

  /**
   * Gatherers whose node has drifted far from any drop-off (a stand or patch ran down and they retargeted
   * around it) move to something closer: a nearer node, a new camp, or a farm.
   */
  private retargetFar(): void {
    let budget = 2;
    for (const v of this.view.villagers) {
      if (budget === 0) return;
      if (v.claimed || v.task.kind !== 'gather' || v.task.slot === 'farm') continue;
      const task = v.task;
      const cur = this.view.nodes.find((n) => n.id === task.targetId);
      if (cur === undefined) continue;
      const dd = this.dropDistance(cur);
      if (dd <= PLAN.campMaxDropDistance + 1.5) continue;
      if (this.assign(v, task.resource, false)) budget--;
    }
  }

  /** Move one gatherer from the most oversubscribed resource to the one furthest below its share. */
  private rebalance(): void {
    const ds = this.deficits().filter((d) => this.hasNodes(d.resource));
    if (ds.length < 2) return;
    const under = ds.reduce((a, b) => (b.deficit > a.deficit ? b : a));
    const over = ds.reduce((a, b) => (b.deficit < a.deficit ? b : a));
    if (under.resource === over.resource) return;
    const surplus = -over.deficit;
    if (!((under.deficit >= 2 && surplus >= 1) || (under.deficit >= 1 && surplus >= 2))) return;
    const donors = this.view.villagers.filter((v) => !v.claimed && v.task.kind === 'gather' && v.task.resource === over.resource);
    if (donors.length === 0) return;
    donors.sort((a, b) => a.carried - b.carried || a.id - b.id);
    const v = donors[0] as VillagerView;
    this.assign(v, under.resource);
  }

  /** Send `v` to work on `resource`, building a camp, mill or farm first if the resource has no drop-off nearby. */
  private assign(v: VillagerView, resource: ResourceType, allowFar = true): boolean {
    if (resource === 'food') return this.assignFood(v);
    return this.assignNode(v, resource, [resource], allowFar);
  }

  /** Can a villager walk from the Town Center to a tile next to the node? (Camps and houses can wall nodes in.) */
  private reachable(n: NodeView): boolean {
    if (this.tc === undefined) return true;
    if (this.reach === null) {
      // Start from a free tile next to the Town Center.
      const t = this.tc;
      let seed: [number, number] = [t.tx - 1, t.ty - 1];
      search: for (let ring = 1; ring < 6; ring++) {
        for (let x = t.tx - ring; x < t.tx + t.size + ring; x++) {
          for (const y of [t.ty - ring, t.ty + t.size + ring - 1]) {
            if (this.solid.isFree(x, y, 1, 0)) {
              seed = [x, y];
              break search;
            }
          }
        }
      }
      this.reach = floodReach(this.solid, seed[0], seed[1]);
    }
    return ringReachable(this.reach, this.view.mapWidth, this.view.mapHeight, n.tx, n.ty, n.size);
  }

  private pickNode(v: VillagerView, nodes: NodeView[]): NodeView | null {
    let best: NodeView | null = null;
    let bestScore = Infinity;
    for (const n of nodes) {
      if (dist(n.cx, n.cy, this.tcCentre.x, this.tcCentre.y) > PLAN.workRadius || !this.reachable(n)) continue;
      const score = this.dropDistance(n) + 0.3 * dist(v.x, v.y, n.cx, n.cy);
      if (score < bestScore - 1e-9 || (Math.abs(score - bestScore) <= 1e-9 && best !== null && n.id < best.id)) {
        best = n;
        bestScore = score;
      }
    }
    return best;
  }

  private gather(v: VillagerView, node: NodeView): void {
    const already = v.task.kind === 'gather' && v.task.targetId === node.id;
    if (!already) {
      this.emit({ type: 'gather', unitIds: [v.id], nodeId: node.id, queue: false });
      node.gatherers++;
    }
    this.claim(v, node.resource);
  }

  /** Help an unfinished camp or mill of this type if it is short of builders. */
  private assistCamp(v: VillagerView, type: BuildingId): boolean {
    const site = this.ofType(type).find((b) => !b.constructed && b.id >= 0 && b.builders < PLAN.campBuilders && dist(v.x, v.y, b.cx, b.cy) < 14);
    if (site === undefined) return false;
    this.emit({ type: 'assist', unitIds: [v.id], buildingId: site.id, queue: false });
    site.builders++;
    this.claim(v, type === 'lumberCamp' ? 'wood' : type === 'mill' ? 'food' : 'gold');
    return true;
  }

  private assignNode(v: VillagerView, resource: ResourceType, slots: string[], allowFar: boolean): boolean {
    const nodes = this.view.nodes.filter((n) => n.resource === resource && slots.includes(n.slot) && n.gatherers < n.maxGatherers);
    const best = this.pickNode(v, nodes);
    if (best === null) return false;
    if (this.dropDistance(best) > PLAN.campMaxDropDistance) {
      const camp = CAMP_FOR[resource];
      if (this.assistCamp(v, camp)) return true;
      const spot = this.campSpot(camp, resource, slots, nodes);
      if (spot !== null && this.construct(camp, spot, [v]) !== null) return true;
      if (!allowFar) return false;
    }
    this.gather(v, best);
    return true;
  }

  /** A camp site next to the densest group of free nodes nearest the base. */
  private campSpot(camp: BuildingId, resource: ResourceType, slots: string[], free: NodeView[]): { tx: number; ty: number } | null {
    const all = this.view.nodes.filter((n) => n.resource === resource && slots.includes(n.slot));
    let seed: NodeView | null = null;
    let seedD = Infinity;
    for (const n of free) {
      const d = dist(n.cx, n.cy, this.tcCentre.x, this.tcCentre.y);
      if (d < seedD) {
        seed = n;
        seedD = d;
      }
    }
    if (seed === null) return null;
    const s = seed;
    return findSpot(this.env(), {
      type: camp,
      near: { x: s.cx, y: s.cy },
      maxDist: 6,
      gap: 0,
      score: (cx, cy) => {
        let count = 0;
        for (const n of all) if (dist(cx, cy, n.cx, n.cy) <= 3.2) count += Math.min(1, n.amount / 100);
        if (count === 0) return Infinity;
        return -count * 10 + dist(cx, cy, s.cx, s.cy) + dist(cx, cy, this.tcCentre.x, this.tcCentre.y) * 0.05;
      },
    });
  }

  private assignFood(v: VillagerView): boolean {
    const berries = this.view.nodes.filter((n) => n.slot === 'berries' && n.gatherers < n.maxGatherers);
    const near = berries.filter((n) => this.dropDistance(n) <= PLAN.campMaxDropDistance);
    const bush = this.pickNode(v, near);
    if (bush !== null) {
      this.gather(v, bush);
      return true;
    }
    // Only bushes far from any drop-off are left: a Mill is worth it for a patch with plenty of food, else farm.
    const far = this.pickNode(v, berries);
    if (far !== null) {
      const patch = this.view.nodes
        .filter((n) => n.slot === 'berries' && dist(n.cx, n.cy, far.cx, far.cy) <= 4)
        .reduce((sum, n) => sum + n.amount, 0);
      if (patch >= PLAN.millMinFood) {
        if (this.assistCamp(v, 'mill')) return true;
        const spot = this.campSpot('mill', 'food', ['berries'], berries);
        if (spot !== null && this.construct('mill', spot, [v]) !== null) return true;
      }
    }
    // Berries are gone or taken: farms.
    let farm: { id: EntityId; building: BuildingView; gatherers: number } | null = null;
    let farmD = Infinity;
    for (const f of this.view.farms) {
      if (f.gatherers > 0) continue;
      const d = dist(v.x, v.y, f.building.cx, f.building.cy);
      if (d < farmD) {
        farm = f;
        farmD = d;
      }
    }
    if (farm !== null) {
      this.emit({ type: 'gather', unitIds: [v.id], nodeId: farm.id, queue: false });
      farm.gatherers++;
      this.claim(v, 'food');
      return true;
    }
    // An unfinished farm with no builder yet: help it, the builder then works it.
    const site = this.ofType('farm').find((b) => !b.constructed && b.id >= 0 && b.builders === 0);
    if (site !== undefined) {
      this.emit({ type: 'assist', unitIds: [v.id], buildingId: site.id, queue: false });
      site.builders++;
      this.claim(v, 'food');
      return true;
    }
    // Farms jump the queue for saved-up wood only while food is short; with food banked the age comes first.
    const farmCost = this.cost('farm');
    const foodShort = this.budget.food < PLAN.farmPriorityFood;
    if (foodShort ? this.affordableNow(farmCost) : this.affordable(farmCost)) {
      const spot = this.farmSpot();
      if (spot !== null && this.construct('farm', spot, [v], foodShort) !== null) return true;
    }
    return false;
  }

  private farmSpot(): { tx: number; ty: number } | null {
    const drops = this.dropOffs('food');
    if (drops.length === 0) return null;
    return findSpot(this.env(), {
      type: 'farm',
      near: this.tcCentre,
      maxDist: 16,
      gap: 0,
      score: (cx, cy) => {
        let best = Infinity;
        for (const d of drops) best = Math.min(best, dist(cx, cy, d.cx, d.cy) - d.size / 2);
        return best > 6 ? Infinity : best + dist(cx, cy, this.tcCentre.x, this.tcCentre.y) * 0.01;
      },
    });
  }

  // -------------------------------------------------------------------------
  // Technologies
  // -------------------------------------------------------------------------

  private techs(): void {
    const reserveTech = this.ageUpAvailable();
    const reserve = reserveTech !== null ? this.cost(reserveTech) : undefined;
    for (const t of PLAN.techs) {
      if (this.view.researched.has(t.id) || !this.available(t.id)) continue;
      const have = t.needs.slot === 'all' ? this.view.villagers.length : this.counts[t.needs.slot];
      if (have < t.needs.count) continue;
      const host = this.ofType(t.building, true)[0];
      if (host === undefined) continue;
      const limit = t.building === 'townCenter' ? 1 : 0;
      if (host.queueLength > limit || host.queuedTechs.length > 0) continue;
      const cost = this.cost(t.id);
      if (!this.affordable(cost, reserve)) continue;
      this.pay(cost);
      this.emit({ type: 'research', buildingId: host.id, techId: t.id });
      return; // one tech per decision keeps spending predictable
    }
  }
}
