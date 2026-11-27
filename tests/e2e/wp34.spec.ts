import { expect, test, type Page } from '@playwright/test';
import { clearSpot, clickEntity, ENEMY, fightGround, gone, hpOf, OPPONENT, pointOn, spawn, unit, units } from './combatHelpers';
import {
  advanceClock,
  card,
  centreCamera,
  cheat,
  clickBuilding,
  collectErrors,
  frames,
  openGround,
  overHud,
  overlayStats,
  placeViaCard,
  SEPARATE_MS,
  selection,
  selectVillager,
  shot,
  startMatch,
  step,
  stepUntil,
  toScreen,
  toasts,
  townCenter,
  villagers,
  type Pt,
} from './helpers';

/**
 * WP34 (PLAN-M2 9.6): the edge cases of the plan (a mixed selection with siege, repair without resources, resigning
 * while paused, the match ending with the menu open, selection and control groups losing units, toasts during mass
 * death) and the UX defects found by playing a full match against the Standard AI (foundation health bars, target
 * mode hints, large selections, the soldiers-first drag box, one idle-villager toast, the setup screen at small sizes).
 * Same rules as every spec: a pinned seed, a paused start, time only through `__game.step`, clicks on verified points.
 */

const setHp = (page: Page, id: number, hp: number): Promise<void> => page.evaluate(([i, h]) => window.__game!.cheat.setHp(i!, h!), [id, hp] as const);

/** Drag a selection box over these world points (with a margin of `pad` screen px); fails if it would touch the HUD. */
async function boxSelect(page: Page, pts: readonly Pt[], pad = 30): Promise<void> {
  const screen = await Promise.all(pts.map((p) => toScreen(page, p.x, p.y)));
  const x0 = Math.min(...screen.map((p) => p.x)) - pad;
  const x1 = Math.max(...screen.map((p) => p.x)) + pad;
  const y0 = Math.min(...screen.map((p) => p.y)) - pad - 20; // unit bodies stand above their feet
  const y1 = Math.max(...screen.map((p) => p.y)) + pad;
  for (const [x, y] of [[x0, y0], [x1, y1], [x0, y1], [x1, y0]] as const) expect(await overHud(page, x, y), `box corner ${x},${y} is off the HUD`).toBe(false);
  await advanceClock(page, SEPARATE_MS);
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 3 });
  await page.mouse.move(x1, y1, { steps: 3 });
  await page.mouse.up();
}

const unitPos = async (page: Page, ids: readonly number[]): Promise<Pt[]> => (await units(page, ids)).map((u) => ({ x: u.x, y: u.y }));

const cardLabels = (page: Page): Promise<string[]> =>
  page.locator('[data-testid="command-card"] button[aria-label]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));

test('a mixed selection with a ram: the drag box leaves the villagers out, the right click splits attack and move, attack-move and a building attack take everyone', async ({ page }) => {
  const errors = collectErrors(page);
  const g = await fightGround(page);
  const soldiers = await spawn(page, [['spearman', g.x, g.y], ['spearman', g.x + 1, g.y], ['batteringRam', g.x + 0.5, g.y + 2]]);
  const [ram] = soldiers.slice(2);
  const walkers = await spawn(page, [['villager', g.x - 1.5, g.y], ['villager', g.x - 1.5, g.y + 1]]);
  const [horse] = await spawn(page, [['horseman', g.x + 6.5, g.y + 0.5]], ENEMY);

  // Soldiers first: the box covers the villagers too, but only the soldiers are selected, so the card is the military one.
  await boxSelect(page, await unitPos(page, [...soldiers, ...walkers]));
  expect(await selection(page)).toEqual([...soldiers].sort((a, b) => a - b));
  expect(await cardLabels(page)).toEqual(expect.arrayContaining(['Attack-move (A)', 'Hold position (S)']));
  // A box over the villagers alone still selects them.
  await boxSelect(page, await unitPos(page, walkers), 14);
  expect(await selection(page)).toEqual([...walkers].sort((a, b) => a - b));
  await boxSelect(page, await unitPos(page, [...soldiers, ...walkers]));
  expect(await selection(page)).toHaveLength(3);

  // Right click on an enemy unit: the spearmen attack it; the ram (buildings only) walks to where it stands.
  const p = await pointOn(page, horse!);
  await page.mouse.move(p.x, p.y);
  expect(await page.evaluate(() => window.__game!.cursor())).toBe('attack');
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await step(page, 1);
  const after = await units(page, soldiers);
  for (const u of after.filter((x) => x.id !== ram)) expect([u.order, u.target]).toEqual(['attack', horse]);
  expect(after.find((x) => x.id === ram)!.order).toBe('move');
  await shot(page, 'wp34-mixed-siege-attack');

  // Attack-move from the card: every selected unit, the ram included.
  await card(page, 'Attack-move').click();
  await expect(page.getByTestId('mode-hint')).toHaveAttribute('data-mode', 'attackMove');
  const dest = await clearSpot(page, g.x - 4, g.y - 4, 0, 1);
  const d = await toScreen(page, dest.x, dest.y);
  expect(await page.evaluate(([x, y]) => window.__game!.pickAt(x!, y!), [d.x, d.y] as const)).toBeNull();
  await page.mouse.click(d.x, d.y);
  await step(page, 1);
  for (const u of await units(page, soldiers)) expect(u.order).toBe('attackMove');
  await expect(page.getByTestId('mode-hint')).toHaveCount(0);

  // A right click on the enemy Town Center: everyone attacks it, the ram too.
  const tc = await page.evaluate(() => {
    const e = window.__game!.state!.entities.find((x) => x.kind === 'building' && x.owner === 2 && x.typeId === 'townCenter')!;
    return { id: e.id, x: (e as { tile: { tx: number } }).tile.tx + 2, y: (e as { tile: { ty: number } }).tile.ty + 2 };
  });
  await centreCamera(page, tc.x, tc.y);
  await clickEntity(page, tc.id, { button: 'right' });
  await step(page, 1);
  for (const u of await units(page, soldiers)) expect([u.order, u.target]).toEqual(['attack', tc.id]);
  expect(errors).toEqual([]);
});

test('repair without resources: the villagers wait, one toast says what is missing, and the repair goes on when wood arrives', async ({ page }) => {
  const errors = collectErrors(page);
  await startMatch(page);
  const tc = await townCenter(page);
  await cheat.resources(page, { wood: 1000, food: 500, gold: 500, stone: 500 });
  await page.evaluate(() => window.__game!.cheat.instantBuild(true));
  await step(page, 1);
  const [v] = await villagers(page);
  await selectVillager(page, v!.id);
  const house = await placeViaCard(page, { menu: 'Economy', label: 'House', size: 2, near: tc, minRing: 5 });
  await page.evaluate(() => window.__game!.cheat.instantBuild(false));
  await step(page, 2);
  const maxHp = (await hpOf(page, house.id))!;
  await setHp(page, house.id, Math.floor(maxHp / 2));
  await cheat.resources(page, { wood: -1_000_000 });
  await step(page, 1);
  await stepUntil(page, `g.state.entities.some((e) => e.id === ${v!.id} && e.currentOrder === null)`, 2000);
  expect((await page.evaluate(() => window.__game!.state!.players[1]!.resources.wood))).toBe(0);

  await centreCamera(page, house.x, house.y);
  await selectVillager(page, v!.id);
  if ((await card(page, 'Repair').count()) === 0) await card(page, 'Back').click();
  await page.keyboard.press('KeyR');
  await expect(page.getByTestId('mode-hint')).toHaveAttribute('data-mode', 'repair');
  await clickEntity(page, house.id);
  await step(page, 1);
  expect((await unit(page, v!.id))!.order).toBe('repair');
  await stepUntil(page, `g.state.entities.some((e) => e.id === ${house.id} && e.repairerIds.length > 0)`, 1000);
  // Repair is bought a fraction of a wood at a time, so it runs on until the first whole wood is due, then stands.
  const stallToasts = async (): Promise<string[]> => (await toasts(page)).filter((t) => t.includes('to repair'));
  let stalled = (await hpOf(page, house.id))!;
  for (let i = 0; i < 40; i++) {
    await step(page, 30);
    const hp = (await hpOf(page, house.id))!;
    if (hp === stalled) break;
    expect(await stallToasts(), 'no toast while the repair still moves').toEqual([]);
    stalled = hp;
  }
  expect(stalled).toBeLessThan(maxHp);
  await step(page, 60);
  expect(await hpOf(page, house.id), 'no wood: no repair').toBe(stalled);
  expect(await stallToasts()).toEqual(['Not enough wood to repair']);
  await step(page, 60);
  expect(await stallToasts(), 'one toast per stall').toEqual(['Not enough wood to repair']);
  await shot(page, 'wp34-repair-stalled');

  // Wood arrives: the repair resumes (hp rises, wood is spent) and no new toast is raised.
  await cheat.resources(page, { wood: 200 });
  await stepUntil(page, `g.state.entities.some((e) => e.id === ${house.id} && e.hp > ${stalled})`, 400);
  await advanceClock(page, 5000);
  await step(page, 1);
  expect(await stallToasts()).toEqual([]);
  expect(await page.evaluate(() => window.__game!.state!.players[1]!.resources.wood)).toBeLessThan(200);
  expect(errors).toEqual([]);
});

test('resigning while paused: the menu closes, a toast says it applies on resume, nothing moves until the next tick, then the defeat screen', async ({ page }) => {
  const errors = collectErrors(page);
  await startMatch(page, OPPONENT);
  const t0 = await page.evaluate(() => window.__game!.state!.tick);
  expect(await page.evaluate(() => window.__game!.paused)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('game-menu')).toBeVisible();
  await page.getByTestId('menu-resign').click();
  await expect(page.getByTestId('resign-confirm')).toBeVisible();
  await page.getByTestId('resign-yes').click();
  await expect(page.getByTestId('game-menu')).toHaveCount(0);
  await expect(page.getByTestId('toast').filter({ hasText: 'Resignation will apply when the game resumes' })).toBeVisible();
  await frames(page, 5);
  expect(await page.evaluate(() => [window.__game!.state!.tick, window.__game!.paused, window.__game!.state!.players[1]!.outcome])).toEqual([t0, true, 'playing']);
  await shot(page, 'wp34-resign-paused');

  // The next tick applies it: defeat, the end screen (which pauses), the toast gone with it.
  await step(page, 2);
  await expect(page.getByTestId('end-screen')).toBeVisible();
  await expect(page.getByTestId('end-title')).toHaveText('Defeat');
  await expect(page.getByTestId('end-subtitle')).toContainText(/resign/i);
  expect(await toasts(page)).toEqual([]);
  await page.getByTestId('end-main-menu').click();
  await expect(page.getByTestId('main-menu')).toBeVisible();
  expect(errors).toEqual([]);
});

test('the match ends with the menu and the Resign question open: the end screen replaces them, stays paused, and View map resumes with no stale banners', async ({ page }) => {
  const errors = collectErrors(page);
  await startMatch(page, OPPONENT);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('game-menu')).toBeVisible();
  await page.getByTestId('menu-resign').click();
  await expect(page.getByTestId('resign-confirm')).toBeVisible();

  // The opponent falls while the question is up (a stepped tick stands in for the last blow).
  await page.evaluate(() => window.__game!.cheat.defeat(2));
  await step(page, 3);
  await expect(page.getByTestId('end-screen')).toBeVisible();
  await expect(page.getByTestId('end-title')).toHaveText('Victory');
  await expect(page.getByTestId('game-menu')).toHaveCount(0);
  expect(await page.evaluate(() => window.__game!.paused)).toBe(true);
  // Nothing behind it announces the same news: no defeat banner, no objective banner, no toasts.
  await expect(page.getByTestId('banner')).toHaveCount(0);
  expect(await toasts(page)).toEqual([]);
  await shot(page, 'wp34-end-over-menu');

  await page.getByTestId('end-view-map').click();
  await expect(page.getByTestId('end-screen')).toHaveCount(0);
  expect(await page.evaluate(() => window.__game!.paused)).toBe(false);
  await page.evaluate(() => window.__game!.setPaused(true));
  await expect(page.getByTestId('game-menu')).toHaveCount(0);
  await advanceClock(page, 6000);
  await frames(page, 2);
  await expect(page.getByTestId('banner')).toHaveCount(0);
  // Esc opens the menu again (input is no longer suspended) and closing it keeps the game paused.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('game-menu')).toBeVisible();
  await page.getByTestId('menu-resume').click();
  expect(await page.evaluate(() => window.__game!.paused)).toBe(true);
  expect(errors).toEqual([]);
});

test('units dying out of the selection and out of a control group: the panel and the card follow, the group recalls the survivors, an empty group does nothing', async ({ page }) => {
  const errors = collectErrors(page);
  const g = await fightGround(page);
  const ids = await spawn(page, [['spearman', g.x, g.y], ['spearman', g.x + 1, g.y], ['archer', g.x, g.y + 1.2], ['archer', g.x + 1, g.y + 1.2]]);
  const [foe] = await spawn(page, [['villager', g.x + 5.5, g.y + 0.5]], ENEMY);
  await boxSelect(page, await unitPos(page, ids));
  expect(await selection(page)).toEqual(ids);
  await page.keyboard.press('Control+Digit1');
  await expect(page.getByTestId('selection-multi')).toContainText('4 selected');

  // Two die: the selection, the panel and the bars drop them at once.
  await setHp(page, ids[0]!, 0);
  await setHp(page, ids[2]!, 0);
  await step(page, 1);
  expect(await selection(page)).toEqual([ids[1], ids[3]]);
  await expect(page.getByTestId('selection-multi')).toContainText('2 selected');
  expect((await overlayStats(page)).healthBars).toBe(2);
  await shot(page, 'wp34-selection-pruned');

  // Select something else, then recall the group: only the survivors.
  await clickEntity(page, foe!);
  expect(await selection(page)).toEqual([foe]);
  await advanceClock(page, SEPARATE_MS);
  await page.keyboard.press('Digit1');
  expect(await selection(page)).toEqual([ids[1], ids[3]]);

  // The selected enemy dies while inspected: the panel empties.
  await clickEntity(page, foe!);
  await setHp(page, foe!, 0);
  await step(page, 1);
  await stepUntil(page, gone(foe!), 5);
  expect(await selection(page)).toEqual([]);
  await expect(page.getByTestId('selection-panel')).toContainText('Nothing selected');
  await expect(page.locator('[data-testid="command-card"] button[aria-label]')).toHaveCount(0);

  // The whole group dies: recalling it selects nothing and changes nothing, twice (no camera jump either).
  await page.keyboard.press('Digit1');
  expect(await selection(page)).toEqual([ids[1], ids[3]]);
  await setHp(page, ids[1]!, 0);
  await setHp(page, ids[3]!, 0);
  await step(page, 1);
  expect(await selection(page)).toEqual([]);
  const cam = await toScreen(page, g.x, g.y);
  await advanceClock(page, SEPARATE_MS);
  await page.keyboard.press('Digit1');
  await page.keyboard.press('Digit1');
  await frames(page, 2);
  expect(await selection(page)).toEqual([]);
  expect(await toScreen(page, g.x, g.y)).toEqual(cam);
  // Assigning an empty selection keeps the (empty) group harmless.
  await page.keyboard.press('Control+Digit1');
  await page.keyboard.press('Digit1');
  expect(await selection(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test('toasts during mass death: a raid wipes out villagers and three houses fall at once; one alert, merged toasts, at most four, no stale pings', async ({ page }) => {
  const errors = collectErrors(page);
  await startMatch(page, OPPONENT);
  const tc = await townCenter(page);
  await cheat.resources(page, { wood: 2000, food: 500, gold: 500, stone: 500 });
  await page.evaluate(() => window.__game!.cheat.instantBuild(true));
  await step(page, 1);
  const [v] = await villagers(page);
  const houses: number[] = [];
  for (let i = 0; i < 3; i++) {
    await selectVillager(page, v!.id);
    houses.push((await placeViaCard(page, { menu: 'Economy', label: 'House', size: 2, near: tc, minRing: 6 })).id);
  }
  await page.evaluate(() => window.__game!.cheat.instantBuild(false));

  // Twelve villagers far from the Town Center, a raid of Cataphracts on top of them.
  const spot = await clearSpot(page, tc.x, tc.y, 14, 4);
  await centreCamera(page, spot.x, spot.y);
  const victims = await spawn(page, Array.from({ length: 12 }, (_, i) => ['villager', spot.x - 1.5 + (i % 4), spot.y - 1 + Math.floor(i / 4)] as const));
  await spawn(page, Array.from({ length: 8 }, (_, i) => ['cataphract', spot.x - 2 + (i % 4) * 1.3, spot.y + 2.5 + Math.floor(i / 4)] as const), ENEMY);
  await stepUntil(page, `[${victims.join(',')}].every((id) => !g.state.entities.some((e) => e.id === id))`, 3000, 10);
  await step(page, 1);
  // Every death is a corpse, but only one "under attack" toast in the 15 s window, and at most four toasts.
  expect((await page.evaluate(() => window.__game!.effects())).corpses).toBeGreaterThanOrEqual(12);
  const t1 = await toasts(page);
  expect(t1.filter((t) => t.startsWith('Your units are under attack'))).toHaveLength(1);
  expect(t1.length).toBeLessThanOrEqual(4);
  expect((await page.evaluate(() => window.__game!.alerts())).length).toBeLessThanOrEqual(4);
  await shot(page, 'wp34-mass-death');

  // Three houses fall in the same tick: one merged toast.
  for (const h of houses) await setHp(page, h, 0);
  await step(page, 2);
  const t2 = await toasts(page);
  expect(t2.filter((t) => t.startsWith('House destroyed'))).toEqual(['House destroyed ×3']);
  expect(t2.length).toBeLessThanOrEqual(4);
  expect(errors).toEqual([]);
});

test('a foundation shows no health bar for its construction hp, only once it is hit or selected', async ({ page }) => {
  const errors = collectErrors(page);
  await startMatch(page);
  const tc = await townCenter(page);
  await cheat.resources(page, { wood: 500 });
  await step(page, 1);
  const [v] = await villagers(page);
  await selectVillager(page, v!.id);
  const house = await placeViaCard(page, { menu: 'Economy', label: 'House', size: 2, near: tc, minRing: 5, complete: false });
  await stepUntil(page, `g.state.entities.some((e) => e.id === ${house.id} && e.builtHp > e.hp - 1 && e.builtHp > 60)`, 2000);
  // Deselect with a click on open ground: the foundation going up has no bar (the progress bar is its own).
  const ground = await openGround(page, tc.x, tc.y, 2);
  expect(await page.evaluate(([x, y]) => window.__game!.pickAt(x!, y!), [ground.sx, ground.sy] as const)).toBeNull();
  await advanceClock(page, SEPARATE_MS);
  await page.mouse.click(ground.sx, ground.sy);
  await step(page, 1);
  expect(await selection(page)).toEqual([]);
  const s0 = await overlayStats(page);
  expect(s0.healthBars).toBe(0);
  expect(s0.bars).toBe(1);
  await shot(page, 'wp34-foundation-no-bar');
  // Hit: it shows.
  const hp = (await hpOf(page, house.id))!;
  await setHp(page, house.id, hp - 20);
  await step(page, 1);
  expect((await overlayStats(page)).healthBars).toBe(1);
  expect(errors).toEqual([]);
});

test('target modes show a hint: attack-move, repair and rally; it goes with the mode', async ({ page }) => {
  const errors = collectErrors(page);
  const g = await fightGround(page);
  const [sp] = await spawn(page, [['spearman', g.x, g.y]]);
  await clickEntity(page, sp!);
  await page.keyboard.press('KeyA');
  await expect(page.getByTestId('mode-hint')).toHaveAttribute('data-mode', 'attackMove');
  await expect(page.getByTestId('mode-hint')).toContainText('Attack-move');
  await shot(page, 'wp34-mode-hint');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('mode-hint')).toHaveCount(0);
  // Right click cancels too.
  await page.keyboard.press('KeyA');
  await expect(page.getByTestId('mode-hint')).toBeVisible();
  const ground = await clearSpot(page, g.x + 3, g.y + 3, 0, 1);
  const p = await toScreen(page, ground.x, ground.y);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await expect(page.getByTestId('mode-hint')).toHaveCount(0);

  const tc = await townCenter(page);
  await centreCamera(page, tc.x, tc.y);
  const [v] = await villagers(page);
  await selectVillager(page, v!.id);
  await page.keyboard.press('KeyR');
  await expect(page.getByTestId('mode-hint')).toHaveAttribute('data-mode', 'repair');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('mode-hint')).toHaveCount(0);
  await clickBuilding(page, tc);
  await card(page, 'Set Rally').click();
  await expect(page.getByTestId('mode-hint')).toHaveAttribute('data-mode', 'rally');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('mode-hint')).toHaveCount(0);
  // The placement hint is still its own (and never shown together with a target hint).
  await selectVillager(page, v!.id);
  await card(page, 'Economy').click();
  await card(page, 'House').click();
  await expect(page.getByTestId('placing-hint')).toBeVisible();
  await expect(page.getByTestId('mode-hint')).toHaveCount(0);
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

/** Every portrait inside the multi grid's visible box is shown whole (none cut by the bottom edge); returns counts. */
async function gridLayout(page: Page): Promise<{ items: number; visible: number; cut: number; scrolls: boolean; dense: boolean }> {
  return page.getByTestId('multi-grid').evaluate((grid) => {
    const g = grid.getBoundingClientRect();
    let visible = 0;
    let cut = 0;
    const items = [...grid.querySelectorAll('.multi-item')];
    for (const it of items) {
      const r = it.getBoundingClientRect();
      if (r.bottom <= g.top + 0.5 || r.top >= g.bottom - 0.5) continue; // scrolled out of view
      if (r.top < g.top - 0.5 || r.bottom > g.bottom + 0.5 || r.right > g.right + 0.5) cut++;
      else visible++;
    }
    return { items: items.length, visible, cut, scrolls: grid.scrollHeight > grid.clientHeight, dense: grid.classList.contains('dense') };
  });
}

test('a 48-unit selection: dense portraits, whole rows only, the rest scroll; at 1280x720 and 800x600', async ({ page }) => {
  const errors = collectErrors(page);
  const g0 = await fightGround(page);
  const g = await clearSpot(page, g0.x, g0.y, 0, 4);
  await centreCamera(page, g.x, g.y);
  const list = Array.from({ length: 48 }, (_, i) => ['spearman', g.x - 4 + (i % 8), g.y - 3 + Math.floor(i / 8)] as const);
  const ids = await spawn(page, list);
  await boxSelect(page, await unitPos(page, ids), 24);
  expect(await selection(page)).toHaveLength(48);
  await expect(page.getByTestId('selection-multi')).toContainText('48 selected');
  // At 1280x720 three dense rows hold 42: the last row scrolls.
  const big = await gridLayout(page);
  expect(big).toMatchObject({ items: 48, cut: 0, scrolls: true, dense: true });
  expect(big.visible).toBeGreaterThanOrEqual(36);
  // Health bars in a crowd (verification fix D9): 48 selected and unhurt show no bars (the rings show the selection);
  // a few hurt ones show full bars; a hurt crowd shows compact ones.
  await frames(page, 2);
  expect(await overlayStats(page)).toMatchObject({ healthBars: 0, compactBars: 0 });
  await page.evaluate((hurt) => hurt.forEach((id) => window.__game!.cheat.setHp(id, 20)), ids.slice(0, 3));
  await step(page, 1);
  await frames(page, 2);
  expect(await overlayStats(page)).toMatchObject({ healthBars: 3, compactBars: 0 });
  await page.evaluate((hurt) => hurt.forEach((id, i) => window.__game!.cheat.setHp(id, 10 + (i % 4) * 10)), ids.slice(0, 30));
  await step(page, 1);
  await frames(page, 2);
  expect(await overlayStats(page)).toMatchObject({ healthBars: 30, compactBars: 1 });
  await shot(page, 'wp34-selection-48-1280');
  // Scrolled to the end: still whole rows.
  await page.getByTestId('multi-grid').evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  await frames(page, 2);
  expect((await gridLayout(page)).cut).toBe(0);

  await page.setViewportSize({ width: 800, height: 600 });
  await frames(page, 3);
  await page.getByTestId('multi-grid').evaluate((el) => el.scrollTo({ top: 0 }));
  await frames(page, 2);
  const small = await gridLayout(page);
  expect(small).toMatchObject({ items: 48, cut: 0, scrolls: true });
  expect(small.visible).toBeGreaterThanOrEqual(12);
  await shot(page, 'wp34-selection-48-800');
  expect(errors).toEqual([]);
});

test('one idle-villager toast that counts the idle villagers, however many times they went idle', async ({ page }) => {
  const errors = collectErrors(page);
  await startMatch(page);
  const tc = await townCenter(page);
  await cheat.resources(page, { wood: 500 });
  await page.evaluate(() => window.__game!.cheat.instantBuild(true));
  await step(page, 1);
  const vs = await villagers(page);
  for (const v of vs.slice(0, 2)) {
    await selectVillager(page, v.id);
    await placeViaCard(page, { menu: 'Economy', label: 'House', size: 2, near: tc, minRing: 5 });
    await step(page, 2);
  }
  const idleNow = await page.evaluate(
    () =>
      window.__game!.state!.entities.filter((e) => e.kind === 'unit' && e.owner === 1 && e.typeId === 'villager' && e.currentOrder === null && e.orderQueue.length === 0 && e.path === null && e.pendingPathRequestId === null).length,
  );
  const idle = (await toasts(page)).filter((t) => /villagers? (is|are) idle/.test(t));
  expect(idle).toEqual([idleNow === 1 ? 'A villager is idle' : `${idleNow} villagers are idle`]);
  expect(errors).toEqual([]);
});

for (const size of [{ width: 640, height: 480 }, { width: 800, height: 600 }] as const) {
  test(`setup screen at ${size.width}x${size.height}: the opponent buttons keep their labels inside, the options fit`, async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize(size);
    await page.goto('/?seed=3&paused=1');
    await page.getByTestId('new-game').click();
    await expect(page.getByTestId('setup-screen')).toBeVisible();
    for (const id of ['easy', 'standard', 'hard', 'none']) {
      const b = page.getByTestId(`setup-opponent-${id}`);
      const m = await b.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, right: el.getBoundingClientRect().right, panel: el.closest('.setup-options')!.getBoundingClientRect().right }));
      expect(m.sw, `${id}: label fits its button`).toBeLessThanOrEqual(m.cw);
      expect(m.right).toBeLessThanOrEqual(m.panel);
    }
    const start = await page.getByTestId('start-match').boundingBox();
    expect(start!.y + start!.height).toBeLessThanOrEqual(size.height);
    await shot(page, `wp34-setup-${size.width}`);
    expect(errors).toEqual([]);
  });
}

test('the frame-rate readout (verification fix D4): ?fps=1 shows fps and the sim cost per tick, F3 hides and shows it', async ({ page }) => {
  const errors = collectErrors(page);
  await startMatch(page, { fps: true });
  const meter = page.getByTestId('fps-meter');
  await expect(meter).toBeVisible();
  await expect(meter).toHaveText(/^\d+ fps \| sim \d+\.\d\d ms\/tick \(max \d+\.\d\)$/);
  // Under the top bar, clear of the HUD's buttons, and never in the way of the pointer.
  expect(await meter.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
  await shot(page, 'wp34-fps-meter');
  await page.keyboard.press('F3');
  await expect(meter).toBeHidden();
  await page.keyboard.press('F3');
  await expect(meter).toBeVisible();
  expect(errors).toEqual([]);
});

test('without ?fps the readout starts hidden and F3 shows it', async ({ page }) => {
  await startMatch(page);
  await expect(page.getByTestId('fps-meter')).toBeHidden();
  await page.keyboard.press('F3');
  await expect(page.getByTestId('fps-meter')).toBeVisible();
});
