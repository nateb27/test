import { expect, test, type Page } from '@playwright/test';
import {
  card,
  centreCamera,
  cheat,
  clickBuilding,
  collectErrors,
  entities,
  buildingsOf,
  frames,
  groupVillagers,
  inputMode,
  overHud,
  placeViaCard,
  player,
  recallVillagers,
  resources,
  selection,
  selectVillager,
  shot,
  startMatch,
  step,
  stepUntil,
  toMinimap,
  toScreen,
  townCenter,
  validGhostSpot,
  villagers,
  type Pt,
} from './helpers';

/**
 * Plan 9.3 scenarios 3 to 11, driven through the real UI: canvas clicks at `worldToScreen` positions, HUD buttons
 * and hotkeys. Time only moves with `window.__game.step`. Resource cheats only shorten waiting for resources
 * (scenario 8 also uses the instant-build and instant-research cheats, as the plan allows).
 * Screenshots go to the git-ignored test-results/screenshots/ (s03-... to s11-...).
 */

/** The nearest tree to a point (at least 6 tiles away), as a world centre. */
async function treeNear(page: Page, cx: number, cy: number): Promise<{ id: number; x: number; y: number }> {
  const t = await page.evaluate(
    ([x0, y0]) => {
      const g = window.__game!;
      let best: { id: number; x: number; y: number } | null = null;
      let bestD = Infinity;
      for (const e of g.state!.entities) {
        if (e.kind !== 'node' || e.typeId !== 'tree') continue;
        const x = e.tile.tx + 0.5;
        const y = e.tile.ty + 0.5;
        const d = Math.hypot(x - x0!, y - y0!);
        if (d < 6) continue;
        if (d < bestD) {
          bestD = d;
          best = { id: e.id, x, y };
        }
      }
      return best;
    },
    [cx, cy] as const,
  );
  if (t === null) throw new Error('no tree on screen');
  return t;
}

test('scenario 3: right-click a tree, wood rises after a round trip; ground beside a tree is ground', async ({ page }) => {
  const errors = collectErrors(page);
  await startMatch(page, { paused: true });
  const tc = await townCenter(page);
  await groupVillagers(page);
  const tree = await treeNear(page, tc.x, tc.y);
  await centreCamera(page, tree.x, tree.y);

  // A ground click right next to the tree is a move, not a gather.
  const beside = await page.evaluate(
    ([id]) => {
      const g = window.__game!;
      const ents = g.state!.entities;
      const t = ents.find((e) => e.id === id)!;
      if (t.kind !== 'node') throw new Error('not a node');
      const sizes: Record<string, number> = { townCenter: 4, goldDeposit: 2, stoneDeposit: 2 };
      // Prefer a neighbour with no other entity around it at all; on a crowded stand any free neighbouring tile will do.
      for (const margin of [1, 0]) {
        for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
          const tx = t.tile.tx + dx;
          const ty = t.tile.ty + dy;
          const taken = ents.some((e) => {
            if (e.kind === 'unit' || e.id === id) return false;
            const n = sizes[e.typeId] ?? 1;
            return tx + 1 > e.tile.tx - margin && tx < e.tile.tx + n + margin && ty + 1 > e.tile.ty - margin && ty < e.tile.ty + n + margin;
          });
          if (!taken) return { x: tx + 0.5, y: ty + 0.5 };
        }
      }
      return null;
    },
    [tree.id] as const,
  );
  expect(beside).not.toBeNull();
  const bp = await toScreen(page, beside!.x, beside!.y);
  expect(await overHud(page, bp.x, bp.y)).toBe(false);
  await page.mouse.click(bp.x, bp.y, { button: 'right' });
  await step(page, 2);
  const orders = await page.evaluate(() => window.__game!.state!.entities.filter((e) => e.kind === 'unit' && e.owner === 1).map((e) => (e.kind === 'unit' ? e.currentOrder?.type : null)));
  expect(new Set(orders)).toEqual(new Set(['move']));

  // The tree itself: gather.
  const start = (await resources(page)).wood;
  const tp = await toScreen(page, tree.x, tree.y);
  await page.mouse.click(tp.x, tp.y, { button: 'right' });
  await step(page, 2);
  const gather = await page.evaluate(() => window.__game!.state!.entities.filter((e) => e.kind === 'unit' && e.owner === 1).map((e) => (e.kind === 'unit' ? e.currentOrder?.type : null)));
  expect(new Set(gather)).toEqual(new Set(['gather']));
  await shot(page, 's03-1-gather-ordered');

  // Walk, harvest, carry: the carried marker shows, then a delivery raises the stockpile.
  await stepUntil(page, `g.state.entities.some((e) => e.kind === 'unit' && e.owner === 1 && e.carried !== null)`, 3000);
  await frames(page, 2);
  await shot(page, 's03-2-carrying');
  await stepUntil(page, `g.state.players[1].resources.wood > ${start}`, 4000);
  expect((await resources(page).then((r) => r.wood)) - start).toBeGreaterThanOrEqual(10);
  await expect(page.getByTestId('res-wood')).toHaveText(String((await resources(page)).wood));
  await shot(page, 's03-3-wood-delivered');
  expect(errors).toEqual([]);
});

test('scenario 4: place a House through the command card; it completes and the population cap rises by 10', async ({ page }) => {
  const errors = collectErrors(page);
  await startMatch(page, { paused: true });
  const tc = await townCenter(page);
  await groupVillagers(page);
  expect(await player(page)).toMatchObject({ popUsed: 6, popCap: 10 });
  await expect(page.getByTestId('pop')).toContainText('6/10');

  // Economy page, then hover the House: the tooltip shows cost and time.
  await card(page, 'Economy').click();
  await shot(page, 's04-1-economy-page');
  await card(page, 'House').hover();
  const tip = page.getByTestId('tooltip');
  await expect(tip).toContainText('House');
  await expect(tip).toContainText('50');
  await expect(tip).toContainText('20s');
  await shot(page, 's04-2-house-tooltip');
  await card(page, 'House').click();
  expect(await inputMode(page)).toBe('placement');
  await expect(page.getByTestId('placing-hint')).toBeVisible();

  // Red over the Town Center: the click is refused with a toast, nothing is spent, the mode stays.
  const tcp = await toScreen(page, tc.x, tc.y);
  await page.mouse.move(tcp.x - 20, tcp.y - 10);
  await page.mouse.move(tcp.x, tcp.y);
  await frames(page, 2);
  expect(await page.evaluate(() => window.__game!.ghost()?.ok)).toBe(false);
  await shot(page, 's04-3-ghost-red');
  const woodBefore = (await resources(page)).wood;
  await page.mouse.click(tcp.x, tcp.y);
  await expect(page.getByTestId('toast').first()).toContainText('Blocked');
  expect(await inputMode(page)).toBe('placement');
  await step(page, 2);
  expect((await resources(page)).wood).toBe(woodBefore);

  // Green on open grass: click to place.
  const spot = await validGhostSpot(page, tc.x, tc.y - 4, 2, 4);
  await shot(page, 's04-4-ghost-green');
  await page.mouse.click(spot.x, spot.y);
  expect(await inputMode(page)).toBeNull();
  await expect(page.getByTestId('placing-hint')).toHaveCount(0);
  await step(page, 2);
  const [house] = await buildingsOf(page, 'house');
  expect(house).toBeDefined();
  expect(house!.constructed).toBe(false);
  expect((await resources(page)).wood).toBe(woodBefore - 50);
  await expect(page.getByTestId('res-wood')).toHaveText(String(woodBefore - 50));
  await step(page, 100);
  await shot(page, 's04-5-building');

  await stepUntil(page, `g.state.entities.some((e) => e.id === ${house!.id} && e.constructed)`, 3000);
  expect(await player(page)).toMatchObject({ popUsed: 6, popCap: 20 });
  await expect(page.getByTestId('pop')).toContainText('6/20');
  await shot(page, 's04-6-house-complete');
  expect(errors).toEqual([]);
});

test('scenario 5: queue a Villager; it spawns and walks to a rally point set on a berry bush', async ({ page }) => {
  const errors = collectErrors(page);
  await startMatch(page, { paused: true });
  const tc = await townCenter(page);
  const bushes = await entities(page, { type: 'berryBush' });
  const bush = [...bushes].sort((a, b) => Math.hypot(a.x - tc.x, a.y - tc.y) - Math.hypot(b.x - tc.x, b.y - tc.y))[0]!;

  // Select the Town Center with a real click, then look at the berries and enter rally mode from the card.
  await clickBuilding(page, tc);
  await expect(page.getByTestId('sel-name')).toHaveText('Town Center');
  await centreCamera(page, bush.x, bush.y);
  await card(page, 'Set Rally').click();
  expect(await inputMode(page)).toBe('rally');
  const bp = await toScreen(page, bush.x, bush.y);
  expect(await overHud(page, bp.x, bp.y)).toBe(false);
  await page.mouse.click(bp.x, bp.y);
  expect(await inputMode(page)).toBeNull();
  expect(await selection(page)).toEqual([tc.id]); // the rally click did not change the selection
  await step(page, 1);
  const rally = await page.evaluate(() => {
    const b = window.__game!.state!.entities.find((e) => e.kind === 'building' && e.owner === 1);
    return b !== undefined && b.kind === 'building' ? b.rally : null;
  });
  expect(rally?.targetId).toBe(bush.id);
  await shot(page, 's05-1-rally-set');

  // Train a villager with the card; the queue shows progress.
  await card(page, 'Villager').click();
  await step(page, 100);
  await expect(page.getByTestId('queue-item-0')).toBeVisible();
  await centreCamera(page, tc.x, tc.y);
  await shot(page, 's05-2-training');
  expect((await resources(page)).food).toBe(150);

  const before = new Set((await villagers(page)).map((v) => v.id));
  await stepUntil(page, `g.state.entities.filter((e) => e.kind === 'unit' && e.owner === 1 && e.typeId === 'villager').length === 7`, 1500);
  const fresh = (await villagers(page)).find((v) => !before.has(v.id))!;
  await step(page, 2);
  const order = await page.evaluate((id) => {
    const u = window.__game!.state!.entities.find((e) => e.id === id);
    return u !== undefined && u.kind === 'unit' ? u.currentOrder : null;
  }, fresh.id);
  expect(order).toMatchObject({ type: 'gather', targetId: bush.id });

  // It walks to the bush and picks berries: food in hand.
  await stepUntil(page, `g.state.entities.some((e) => e.id === ${fresh.id} && e.carried !== null && e.carried.type === 'food')`, 2500);
  await centreCamera(page, bush.x, bush.y);
  await shot(page, 's05-3-gathering-berries');
  const d = await entities(page, { type: 'villager', own: true });
  const now = d.find((v) => v.id === fresh.id)!;
  expect(Math.hypot(now.x - bush.x, now.y - bush.y)).toBeLessThan(3);
  expect(errors).toEqual([]);
});

test('scenario 6: reach the population cap: the queue holds with a toast; a House releases it', async ({ page }) => {
  const errors = collectErrors(page);
  await startMatch(page, { paused: true });
  const tc = await townCenter(page);
  await cheat.resources(page, { food: 600 }); // shortens the wait for food only
  await groupVillagers(page);

  // Five villagers with the Q hotkey: four fit under the cap of 10, the fifth waits.
  await clickBuilding(page, tc);
  for (let i = 0; i < 5; i++) await page.keyboard.press('KeyQ');
  await step(page, 2);
  // Queued units do not count: the counter shows living units only (plan 4.6).
  await expect(page.getByTestId('pop')).toContainText('6/10');
  await expect(page.getByTestId('pop')).not.toHaveClass(/capped/);
  await shot(page, 's06-1-queued');
  await stepUntil(page, `g.state.entities.some((e) => e.kind === 'building' && e.owner === 1 && e.queue.some((q) => q.popCapNotified))`, 4000);
  await expect(page.getByTestId('toast').filter({ hasText: 'Build more houses' })).toBeVisible();
  await expect(page.getByTestId('pop')).toContainText('10/10');
  await expect(page.getByTestId('pop')).toHaveClass(/capped/);
  expect((await villagers(page)).length).toBe(10);
  await shot(page, 's06-2-capped');
  await step(page, 400);
  expect((await villagers(page)).length).toBe(10); // still held
  const held = await page.evaluate(() => {
    const b = window.__game!.state!.entities.find((e) => e.kind === 'building' && e.owner === 1);
    return b !== undefined && b.kind === 'building' ? b.queue.map((q) => ({ done: q.ticksDone, total: q.ticksTotal })) : [];
  });
  expect(held).toHaveLength(1);
  expect(held[0]!.done).toBe(held[0]!.total);
  await expect(page.getByTestId('queue-item-0')).toBeVisible();

  // Build a House with the villagers: the held villager appears.
  await cheat.resources(page, { wood: 100 });
  await recallVillagers(page);
  await placeViaCard(page, { menu: 'Economy', label: 'House', size: 2, near: tc, minRing: 4 });
  await step(page, 5);
  expect((await villagers(page)).length).toBe(11);
  expect(await player(page)).toMatchObject({ popUsed: 11, popCap: 20 });
  await expect(page.getByTestId('pop')).toContainText('11/20');
  await expect(page.getByTestId('pop')).not.toHaveClass(/capped/);
  await shot(page, 's06-3-released');
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// Ages through the UI
// ---------------------------------------------------------------------------

const ALL = { food: 6000, wood: 6000, gold: 6000, stone: 6000 };

/** Select the Town Center (H also centres it), then click an age or tech button on its card and wait for the result. */
async function researchAt(page: Page, label: string, done: string, max: number): Promise<void> {
  await page.keyboard.press('KeyH');
  await card(page, label).click();
  await stepUntil(page, done, max);
  await step(page, 3);
}

async function build(page: Page, menu: 'Economy' | 'Military', label: string, size: number, near: Pt, minRing = 3): Promise<void> {
  await recallVillagers(page);
  await placeViaCard(page, { menu, label, size, near, minRing });
  await step(page, 3);
}

const ageIs = (n: number): string => `g.state.players[1].age === ${n}`;

/** Founding to Township: a Lumber Camp and a Mill (two distinct Age 1 buildings), then the age technology. */
async function reachTownship(page: Page, tc: Pt): Promise<void> {
  await build(page, 'Economy', 'Lumber Camp', 2, tc, 5);
  await build(page, 'Economy', 'Mill', 2, tc, 5);
  await researchAt(page, 'Township Age', ageIs(2), 4000);
  await expect(page.getByTestId('age')).toContainText('Township Age');
}

/** Township to Citadel: Archery Range and Stable, then the age technology. */
async function reachCitadel(page: Page, tc: Pt): Promise<void> {
  await build(page, 'Military', 'Archery Range', 3, tc, 6);
  await build(page, 'Military', 'Stable', 3, tc, 6);
  await researchAt(page, 'Citadel Age', ageIs(3), 5000);
  await expect(page.getByTestId('age')).toContainText('Citadel Age');
}

test('scenario 7: research Iron Axes at the Lumber Camp; the wood gather rate rises by 15%', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await startMatch(page, { paused: true });
  const tc = await townCenter(page);
  await cheat.resources(page, ALL);
  await groupVillagers(page);
  await reachTownship(page, tc);
  await shot(page, 's07-1-township');

  // Everyone chops wood: measure the harvest rate of villagers that are harvesting with room to spare.
  const tree = await treeNear(page, tc.x, tc.y);
  await centreCamera(page, tree.x, tree.y);
  await recallVillagers(page);
  const tp = await toScreen(page, tree.x, tree.y);
  await page.mouse.click(tp.x, tp.y, { button: 'right' });
  await step(page, 2); // the order applies on the next tick
  const measure = async (): Promise<number> => {
    await stepUntil(
      page,
      `g.state.entities.filter((e) => e.kind === 'unit' && e.owner === 1 && e.currentOrder && e.currentOrder.type === 'gather' && e.currentOrder.phase === 'harvesting' && (e.carried === null || e.carried.amount <= 4)).length >= 2`,
      4000,
      5,
    );
    return page.evaluate(() => {
      const g = window.__game!;
      const eff = (e: { carried: { amount: number } | null; currentOrder: { type: string; harvestAccumulator?: number } | null }): number =>
        (e.carried?.amount ?? 0) + (e.currentOrder?.type === 'gather' ? (e.currentOrder.harvestAccumulator ?? 0) : 0);
      const pick = g.state!.entities.filter(
        (e) => e.kind === 'unit' && e.owner === 1 && e.currentOrder?.type === 'gather' && e.currentOrder.phase === 'harvesting' && (e.carried === null || e.carried.amount <= 4),
      );
      const t0 = new Map(pick.map((e) => [e.id, e.kind === 'unit' ? eff(e) : 0]));
      g.step(100);
      let total = 0;
      let n = 0;
      for (const e of g.state!.entities) {
        if (e.kind !== 'unit' || !t0.has(e.id) || e.currentOrder?.type !== 'gather' || e.currentOrder.phase !== 'harvesting') continue;
        const gained = eff(e) - t0.get(e.id)!;
        if (gained < 0) continue; // delivered in between
        total += gained;
        n++;
      }
      if (n === 0) {
        const now = g.state!.entities.filter((e) => e.kind === 'unit' && e.owner === 1).map((e) => (e.kind === 'unit' ? [e.id, e.currentOrder?.type, e.currentOrder?.type === 'gather' ? e.currentOrder.phase : '', e.carried?.amount ?? 0] : []));
        throw new Error(`nobody kept harvesting: ${JSON.stringify([...t0])} now ${JSON.stringify(now)}`);
      }
      return total / n / (100 / 20);
    });
  };
  const before = await measure();
  expect(before).toBeCloseTo(0.4, 1);
  await shot(page, 's07-2-chopping');

  // Research Iron Axes: select the Lumber Camp with a click, use its card.
  const [camp] = await buildingsOf(page, 'lumberCamp');
  await centreCamera(page, camp!.x, camp!.y);
  await clickBuilding(page, camp!);
  await expect(card(page, 'Iron Axes')).toBeVisible();
  await card(page, 'Iron Axes').hover();
  await expect(page.getByTestId('tooltip')).toContainText('Iron Axes');
  await expect(page.getByTestId('tooltip')).toContainText('100');
  await shot(page, 's07-3-iron-axes-tooltip');
  await card(page, 'Iron Axes').click();
  await step(page, 100);
  await expect(page.getByTestId('queue-item-0')).toBeVisible();
  await shot(page, 's07-4-researching');
  await stepUntil(page, `g.state.players[1].researched.includes('ironAxes')`, 1200);
  await step(page, 2);
  // The tech leaves the card once researched.
  await expect(card(page, 'Iron Axes')).toHaveCount(0);

  const after = await measure();
  expect(after).toBeCloseTo(0.46, 1);
  expect(after / before).toBeGreaterThan(1.1);
  expect(after / before).toBeLessThan(1.2);
  await shot(page, 's07-5-faster');
  expect(errors).toEqual([]);
});

test('scenario 8: with cheats, advance through all four ages; the Cataphract and Siphonarios unlock, the Lancer never appears, the objective banner shows', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await startMatch(page, { paused: true });
  const tc = await townCenter(page);
  await groupVillagers(page);
  // The cheats this scenario is allowed: resources, instant construction and instant research.
  await page.evaluate((all) => {
    window.__game!.cheat.addResources(all);
    window.__game!.cheat.instantBuild(true);
    window.__game!.cheat.instantResearch(true);
  }, ALL);
  await step(page, 1);

  // Age buttons start greyed with a reason.
  await page.keyboard.press('KeyH');
  await expect(card(page, 'Township Age')).toHaveAttribute('aria-disabled', 'true');
  await card(page, 'Township Age').hover();
  await expect(page.getByTestId('tooltip')).toContainText('Needs 2 different buildings');
  await shot(page, 's08-1-age-greyed');
  await expect(page.getByTestId('age')).toContainText('Founding Age');

  await build(page, 'Economy', 'Lumber Camp', 2, tc, 5);
  await build(page, 'Economy', 'Mill', 2, tc, 5);
  await expect(card(page, 'Township Age')).toHaveCount(0); // selection is the villagers now
  await page.keyboard.press('KeyH');
  await expect(card(page, 'Township Age')).toHaveAttribute('aria-disabled', 'false');
  await card(page, 'Township Age').click();
  await stepUntil(page, ageIs(2), 200);
  await step(page, 2);
  await expect(page.getByTestId('age')).toContainText('Township Age');
  await shot(page, 's08-2-township');

  // Age 2 buildings were greyed in Age 1 and unlock now.
  await build(page, 'Military', 'Archery Range', 3, tc, 6);
  await build(page, 'Military', 'Stable', 3, tc, 6);
  await researchAt(page, 'Citadel Age', ageIs(3), 200);
  await expect(page.getByTestId('age')).toContainText('Citadel Age');
  await shot(page, 's08-3-citadel');

  // Stable: the Cataphract is offered and enabled, the Lancer never appears.
  const [stable] = await buildingsOf(page, 'stable');
  await centreCamera(page, stable!.x, stable!.y);
  await clickBuilding(page, stable!);
  await expect(card(page, 'Cataphract')).toHaveAttribute('aria-disabled', 'false');
  await expect(card(page, 'Lancer')).toHaveCount(0);
  await expect(card(page, 'Horseman')).toHaveCount(1);
  await shot(page, 's08-4-stable-cataphract');
  await card(page, 'Cataphract').click();
  await stepUntil(page, `g.state.entities.some((e) => e.kind === 'unit' && e.owner === 1 && e.typeId === 'cataphract')`, 200);

  await build(page, 'Military', 'Siege Workshop', 3, tc, 6);
  await build(page, 'Economy', 'Silk Workshop', 3, tc, 6);
  await researchAt(page, 'Empire Age', ageIs(4), 200);
  await expect(page.getByTestId('age')).toContainText('Empire Age');
  await shot(page, 's08-5-empire');

  // Banners queue one at a time (5 s each): the objective banner shows with the elapsed game time.
  await expect(page.getByTestId('banner').filter({ hasText: 'Objective complete' })).toBeVisible({ timeout: 25_000 });
  await shot(page, 's08-6-objective-banner');
  const completions = await page.evaluate(() => window.__game!.state!.objectives.entries.filter((o) => o.completedTick !== null).length);
  expect(completions).toBe(1);

  // Siege Workshop: Siphonarios offered and enabled in Empire Age.
  const [siege] = await buildingsOf(page, 'siegeWorkshop');
  await centreCamera(page, siege!.x, siege!.y);
  await clickBuilding(page, siege!);
  await expect(card(page, 'Siphonarios')).toHaveAttribute('aria-disabled', 'false');
  await card(page, 'Siphonarios').click();
  await stepUntil(page, `g.state.entities.some((e) => e.kind === 'unit' && e.owner === 1 && e.typeId === 'siphonarios')`, 200);
  await shot(page, 's08-7-siphonarios');
  expect(errors).toEqual([]);
});

test('scenario 9: Silk Workshops pay gold with nobody mining; a fourth cannot be placed', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await startMatch(page, { paused: true });
  const tc = await townCenter(page);
  await cheat.resources(page, ALL);
  await groupVillagers(page);
  await reachTownship(page, tc);
  await reachCitadel(page, tc);

  const silk: Awaited<ReturnType<typeof placeViaCard>>[] = [];
  const gold = async (): Promise<number> => (await resources(page)).gold;
  // Nobody is mining: no villager has a gold gather order or carries gold (they only built things).
  const noMiners = (): Promise<boolean> =>
    page.evaluate(() => {
      const g = window.__game!;
      const ents = g.state!.entities;
      const goldNodes = new Set(ents.filter((e) => e.kind === 'node' && e.typeId === 'goldDeposit').map((e) => e.id));
      return ents.every((e) => e.kind !== 'unit' || (e.carried?.type !== 'gold' && !(e.currentOrder?.type === 'gather' && goldNodes.has(e.currentOrder.targetId))));
    });

  await recallVillagers(page);
  silk.push(await placeViaCard(page, { menu: 'Economy', label: 'Silk Workshop', size: 3, near: tc, minRing: 6, ghostShot: 's09-1-silk-ghost' }));
  await step(page, 3);
  await page.keyboard.press('KeyH');
  const g0 = await gold();
  await step(page, 400);
  expect(await noMiners()).toBe(true);
  expect((await gold()) - g0).toBe(5); // 0.25 gold per second for 20 s
  await expect(page.getByTestId('res-gold')).toHaveText(String(await gold()));
  await shot(page, 's09-2-one-workshop');

  await build(page, 'Economy', 'Silk Workshop', 3, tc, 6);
  await build(page, 'Economy', 'Silk Workshop', 3, tc, 6);
  expect(await buildingsOf(page, 'silkWorkshop')).toHaveLength(3);
  const g1 = await gold();
  await step(page, 400);
  expect(await noMiners()).toBe(true);
  expect((await gold()) - g1).toBe(15); // three workshops
  await shot(page, 's09-3-three-workshops');

  // A fourth: the card button is greyed with the reason, a click only toasts it, and no placement mode starts.
  await recallVillagers(page);
  if ((await card(page, 'Silk Workshop').count()) === 0) await card(page, 'Economy').click();
  const button = card(page, 'Silk Workshop');
  await expect(button).toHaveAttribute('aria-disabled', 'true');
  await button.hover();
  await expect(page.getByTestId('tooltip')).toContainText('Limit');
  await shot(page, 's09-4-fourth-greyed');
  await button.click({ force: true }); // greyed, not disabled: the click explains why
  expect(await inputMode(page)).toBeNull();
  await expect(page.getByTestId('toast').first()).toBeVisible();
  const count = (await buildingsOf(page, 'silkWorkshop')).length;
  expect(count).toBe(3);
  expect(errors).toEqual([]);
});

test('scenario 10: save, reload the page, load: the state hash matches', async ({ page }) => {
  const errors = collectErrors(page);
  await startMatch(page, { paused: true });
  const tc = await townCenter(page);
  await groupVillagers(page);
  // Some history: a House under construction, a villager in the queue, gatherers working.
  await placeViaCard(page, { menu: 'Economy', label: 'House', size: 2, near: tc, minRing: 4, complete: false });
  const tree = await treeNear(page, tc.x, tc.y);
  await centreCamera(page, tree.x, tree.y);
  await recallVillagers(page);
  const tp = await toScreen(page, tree.x, tree.y);
  await page.mouse.click(tp.x, tp.y, { button: 'right' });
  await page.keyboard.press('KeyH');
  await card(page, 'Villager').click();
  await step(page, 700);
  const saved = await page.evaluate(() => ({ tick: window.__game!.state!.tick, hash: window.__game!.hash() }));
  expect(saved.tick).toBeGreaterThan(600);

  // Save through the in-match menu.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('game-menu')).toBeVisible();
  await page.getByTestId('menu-save').click();
  await page.getByTestId('save-new').click();
  await expect(page.getByTestId('saveload-message')).toContainText('Saved');
  await shot(page, 's10-1-saved');

  // Reload the page (a new match starts paused with ?paused), then load from the main menu.
  await page.goto('/?paused=1');
  await expect(page.getByTestId('main-menu')).toBeVisible();
  await page.getByTestId('load-game').click();
  await expect(page.getByTestId('save-list').locator('li')).toHaveCount(1);
  await shot(page, 's10-2-load-list');
  await page.locator('[data-testid^="load-save-"]').first().click();
  await expect(page.locator('canvas.world-canvas')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('hud')).toBeVisible();
  const loaded = await page.evaluate(() => ({ tick: window.__game!.state!.tick, hash: window.__game!.hash(), paused: window.__game!.paused }));
  expect(loaded).toEqual({ tick: saved.tick, hash: saved.hash, paused: true });
  await shot(page, 's10-3-loaded');

  // And the loaded game plays on identically to a fresh replay: it keeps ticking.
  await step(page, 50);
  expect(await page.evaluate(() => window.__game!.state!.tick)).toBe(saved.tick + 50);
  expect(errors).toEqual([]);
});

test('scenario 11: minimap click and drag move the camera; pan, zoom and bounds clamp', async ({ page }) => {
  const errors = collectErrors(page);
  await startMatch(page, { paused: true });
  const cameraAt = (): Promise<Pt> =>
    page.evaluate(() => {
      const g = window.__game!;
      const o = g.worldToScreen(0, 0);
      const sx = 640 - o.x;
      const sy = 360 - o.y;
      return { x: (sx / 32 + sy / 16) / 2, y: (sy / 16 - sx / 32) / 2 };
    });
  const zoomOf = async (): Promise<number> => {
    const a = await toScreen(page, 50, 50);
    const b = await toScreen(page, 60, 50);
    return (b.x - a.x) / 320;
  };

  // Click: the camera centres on that world point (the minimap's own pixel is less than a tile).
  const target = { x: 30, y: 85 };
  const m = await toMinimap(page, target.x, target.y);
  await page.mouse.click(m.x, m.y);
  await frames(page, 3);
  let c = await cameraAt();
  expect(Math.hypot(c.x - target.x, c.y - target.y)).toBeLessThan(2);
  await shot(page, 's11-1-minimap-click');

  // Drag follows the pointer.
  const a = await toMinimap(page, 85, 30);
  const b = await toMinimap(page, 75, 60);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await frames(page, 2);
  c = await cameraAt();
  expect(Math.hypot(c.x - 75, c.y - 60)).toBeLessThan(2);
  await page.mouse.up();
  await shot(page, 's11-2-minimap-drag');

  // Arrow keys pan.
  const p0 = await toScreen(page, 60, 60);
  await page.mouse.move(640, 300);
  await page.keyboard.down('ArrowLeft');
  await expect.poll(async () => (await toScreen(page, 60, 60)).x).toBeGreaterThan(p0.x + 150);
  await page.keyboard.up('ArrowLeft');

  // Wheel zoom is clamped to 0.5x - 2x.
  expect(await zoomOf()).toBeCloseTo(1, 2);
  await page.mouse.move(640, 300);
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, -500);
  await expect.poll(zoomOf).toBeCloseTo(2, 2);
  await shot(page, 's11-3-zoom-in');
  for (let i = 0; i < 16; i++) await page.mouse.wheel(0, 500);
  await expect.poll(zoomOf).toBeCloseTo(0.5, 2);
  await shot(page, 's11-4-zoom-out');

  // Bounds: hold the arrow until the view stops; the map's corner stays within 96 px of the window edge.
  await page.keyboard.down('ArrowRight');
  let last = (await toScreen(page, 120, 0)).x;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(250);
    const now = (await toScreen(page, 120, 0)).x;
    if (Math.abs(now - last) < 0.01) break;
    last = now;
  }
  await page.keyboard.up('ArrowRight');
  expect(Math.abs((await toScreen(page, 120, 0)).x - (1280 - 96 * 0.5))).toBeLessThan(2);
  await shot(page, 's11-5-clamped');
  expect(errors).toEqual([]);
});

test('construction through the UI: assist by right click, builder works the new farm, cancel refunds', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await startMatch(page, { paused: true });
  const tc = await townCenter(page);
  await cheat.resources(page, { wood: 400 });
  await step(page, 1); // cheats are commands: they apply on the next tick
  const vs = await villagers(page);
  const [v1, v2, v3, v4] = [...vs].sort((a, b) => b.x + b.y - (a.x + a.y)).map((v) => v.id) as [number, number, number, number];
  const orderOf = (id: number): Promise<{ type: string; targetId?: number; buildingId?: number } | null> =>
    page.evaluate((u) => {
      const e = window.__game!.state!.entities.find((x) => x.id === u);
      return e !== undefined && e.kind === 'unit' ? (e.currentOrder as { type: string; targetId?: number; buildingId?: number } | null) : null;
    }, id);

  // One villager builds a farm for 40 wood (Themata); a second one helps with a right click on the foundation.
  const woodBefore = (await resources(page)).wood;
  await selectVillager(page, v1);
  const farm = await placeViaCard(page, { menu: 'Economy', label: 'Farm', size: 2, near: tc, minRing: 4, complete: false });
  await step(page, 2);
  expect((await resources(page)).wood).toBe(woodBefore - 40);
  await selectVillager(page, v2);
  const fp = await toScreen(page, farm.x, farm.y);
  await page.mouse.click(fp.x, fp.y, { button: 'right' });
  await step(page, 2);
  expect((await orderOf(v2))?.type).toBe('assist');
  expect((await orderOf(v1))?.type).toBe('build');
  await shot(page, 's12-1-two-builders');
  await stepUntil(page, `g.state.entities.some((e) => e.id === ${farm.id} && e.constructed)`, 3000);
  await step(page, 3);
  // One builder (the lower unit id, which acts first) works the farm by itself; a farm takes one worker, the other idles.
  const after = [await orderOf(v1), await orderOf(v2)];
  expect(after.filter((o) => o?.type === 'gather' && o.targetId === farm.id)).toHaveLength(1);
  expect(after.filter((o) => o === null)).toHaveLength(1);
  await stepUntil(page, `g.state.players[1].resources.food > 200`, 3000);
  await shot(page, 's12-2-farming');

  // A third villager sent to the busy farm with a right click gets the order (and finds nothing free, so it idles).
  await selectVillager(page, v3);
  await page.mouse.click(fp.x, fp.y, { button: 'right' });
  await step(page, 2);
  expect(['gather', null]).toContain((await orderOf(v3))?.type ?? null);

  // Cancel: place a House with a fourth villager, select the foundation, Cancel on its card: full refund.
  await selectVillager(page, v4);
  const wood = (await resources(page)).wood;
  const house = await placeViaCard(page, { menu: 'Economy', label: 'House', size: 2, near: tc, minRing: 5, complete: false });
  await step(page, 2);
  expect((await resources(page)).wood).toBe(wood - 50);
  await centreCamera(page, house.x, house.y);
  await clickBuilding(page, house);
  await expect(card(page, 'Cancel')).toBeVisible();
  await shot(page, 's12-3-cancel-card');
  await card(page, 'Cancel').click();
  await step(page, 2);
  expect((await resources(page)).wood).toBe(wood);
  expect(await buildingsOf(page, 'house')).toHaveLength(0);
  expect(errors).toEqual([]);
});
