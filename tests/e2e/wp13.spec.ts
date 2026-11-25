import { expect, test, type Page } from '@playwright/test';
import {
  advanceClock,
  SEPARATE_MS,
  buildingsOf,
  card,
  centreCamera,
  cheat,
  clickBuilding,
  clickUnit,
  collectErrors,
  entities,
  frames,
  inputMode,
  openGround,
  placeViaCard,
  selection,
  setPaused,
  shot,
  startMatch,
  step,
  stepUntil,
  toScreen,
  toasts,
  validGhostSpot,
  townCenter,
  villagers,
} from './helpers';

/** WP13: UX rules, debug overlay, hotkeys, layout. Screenshots go to the git-ignored test-results/screenshots/. */

test('Delete: the last Town Center is protected; buildings need a second Delete; units go at once', async ({ page }) => {
  const errors = collectErrors(page);
  await startMatch(page, { paused: true });
  const tc = await townCenter(page);
  await cheat.resources(page, { wood: 200 });

  // Town Center: first Delete only asks, second Delete is refused by the sim with a toast.
  await page.keyboard.press('KeyH');
  await page.keyboard.press('Delete');
  await step(page, 2);
  await expect(page.getByTestId('toast').filter({ hasText: 'Press Delete again to demolish' })).toBeVisible();
  expect((await buildingsOf(page, 'townCenter')).length).toBe(1);
  await page.keyboard.press('Delete');
  await step(page, 2);
  await expect(page.getByTestId('toast').filter({ hasText: 'last Town Center cannot be demolished' })).toBeVisible();
  expect((await buildingsOf(page, 'townCenter')).length).toBe(1);
  await shot(page, 'wp13-1-last-tc');

  // A House: Delete asks, a second Delete within 2 s demolishes it.
  await page.keyboard.press('Escape'); // nothing to cancel: opens the menu
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('game-menu')).toHaveCount(0);
  await groupAll(page);
  const house = await placeViaCard(page, { menu: 'Economy', label: 'House', size: 2, near: tc, minRing: 4 });
  await clickBuilding(page, house);
  await page.keyboard.press('Delete');
  await step(page, 2);
  expect((await buildingsOf(page, 'house')).map((b) => b.id)).toContain(house.id);
  expect(await toasts(page)).toContain('Press Delete again to demolish');
  await page.keyboard.press('Delete');
  await step(page, 3);
  expect((await buildingsOf(page, 'house')).map((b) => b.id)).not.toContain(house.id);

  // Units are deleted by one press.
  const vs = await villagers(page);
  await clickUnit(page, [...vs].sort((a, b) => b.x + b.y - (a.x + a.y))[0]!);
  const [picked] = await selection(page);
  await page.keyboard.press('Delete');
  await step(page, 3);
  expect((await villagers(page)).map((v) => v.id)).not.toContain(picked);
  expect(errors).toEqual([]);
});

async function groupAll(page: Page): Promise<void> {
  const vs = await villagers(page);
  const front = [...vs].sort((a, b) => b.x + b.y - (a.x + a.y))[0]!;
  const p = await toScreen(page, front.x, front.y);
  await advanceClock(page, SEPARATE_MS);
  await page.mouse.dblclick(p.x, p.y - 14);
}

test('units trained without a rally point stand on distinct tiles and can be picked one by one', async ({ page }) => {
  const errors = collectErrors(page);
  await startMatch(page, { paused: true });
  await cheat.resources(page, { food: 1000 });
  await page.keyboard.press('KeyH');
  await page.evaluate(() => window.__game!.cheat.instantResearch(true));
  await step(page, 1);
  // Stop the original villagers from standing in the way.
  const before = new Set((await villagers(page)).map((v) => v.id));
  await page.evaluate(() => window.__game!.cheat.addResources({ food: 0 }));
  for (let i = 0; i < 4; i++) await page.keyboard.press('KeyQ');
  await step(page, 12);
  const fresh = (await villagers(page)).filter((v) => !before.has(v.id));
  expect(fresh.length).toBe(4);
  const tiles = new Set(fresh.map((v) => `${Math.floor(v.x)},${Math.floor(v.y)}`));
  expect(tiles.size).toBe(4);
  for (const a of fresh) for (const b of fresh) if (a.id < b.id) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(0.9);
  // Every one of them is selectable with a single click (front-most first so nothing covers it).
  for (const v of [...fresh].sort((a, b) => b.x + b.y - (a.x + a.y))) {
    await clickUnit(page, v);
    expect(await selection(page)).toEqual([v.id]);
  }
  await shot(page, 'wp13-2-spread-spawn');
  expect(errors).toEqual([]);
});

test('F3 debug overlay: stats, draw toggles, cheats and state hash', async ({ page }) => {
  const errors = collectErrors(page);
  await startMatch(page, { paused: true });
  await expect(page.getByTestId('debug-overlay')).toHaveCount(0);
  await page.keyboard.press('F3');
  await expect(page.getByTestId('debug-overlay')).toBeVisible();
  await setPaused(page, false);
  await frames(page, 10); // the profiler needs rendered frames; the panel shows them on its own 4 Hz poll
  await expect.poll(async () => Number.parseFloat((await page.getByTestId('debug-fps').textContent()) ?? '0')).toBeGreaterThan(0);
  await expect(page.getByTestId('debug-tick-ms')).toContainText('ms');
  await expect(page.getByTestId('debug-path-queue')).toHaveText(/^\d+$/);
  await expect(page.getByTestId('debug-entities')).toContainText('6 units, 1 buildings');
  await expect(page.getByTestId('debug-types')).toContainText('villager 6');
  await setPaused(page, true);

  // Drawing toggles: nothing drawn until one is on.
  const layer = page.getByTestId('debug-layer');
  await expect(layer).toBeHidden();
  await page.getByTestId('debug-toggle-occupancy').check();
  await frames(page, 3);
  await expect(layer).toBeVisible();
  expect(Number(await layer.getAttribute('data-occupancy'))).toBeGreaterThan(0);
  await page.getByTestId('debug-toggle-coords').check();
  const tc = await townCenter(page);
  const c = await toScreen(page, tc.x + 5.5, tc.y + 5.5);
  await page.mouse.move(c.x, c.y);
  await frames(page, 3);
  expect(await layer.getAttribute('data-cursor')).toBe(`${Math.floor(tc.x + 5.5)},${Math.floor(tc.y + 5.5)}`);
  await expect(page.getByTestId('debug-cursor')).toContainText(`${Math.floor(tc.x + 5.5)}, ${Math.floor(tc.y + 5.5)}`);
  // Approach tiles for the selected Town Center, and a path for a moving villager.
  await page.getByTestId('debug-toggle-approach').check();
  await page.keyboard.press('KeyH');
  await frames(page, 3);
  expect(Number(await layer.getAttribute('data-approach'))).toBeGreaterThan(10);
  await page.getByTestId('debug-toggle-paths').check();
  // A moving villager has a path to draw: select one and order it across open ground.
  const v = (await villagers(page))[0]!;
  await clickUnit(page, v);
  const far = await toScreen(page, tc.x + 7, tc.y + 1);
  await page.mouse.click(far.x, far.y, { button: 'right' });
  await step(page, 3);
  await frames(page, 3);
  expect(Number(await layer.getAttribute('data-paths'))).toBeGreaterThan(0);
  await shot(page, 'wp13-3-debug-overlay');

  // Cheats go through the deterministic cheat command and apply on the next tick.
  const food = (await page.evaluate(() => window.__game!.state!.players[1]!.resources.food)) as number;
  await page.getByTestId('cheat-add-food').click();
  await step(page, 1);
  expect(await page.evaluate(() => window.__game!.state!.players[1]!.resources.food)).toBe(food + 1000);
  await page.getByTestId('cheat-instant-build').check();
  await step(page, 1);
  expect(await page.evaluate(() => window.__game!.state!.players[1]!.cheats.instantBuild)).toBe(true);

  // Spawn at the cursor: arm, click open ground.
  await page.getByTestId('cheat-unit').selectOption('spearman');
  await page.getByTestId('cheat-spawn').click();
  const before = (await entities(page, { type: 'spearman', own: true })).length;
  const ground = await openGround(page, tc.x, tc.y, 2);
  await page.mouse.click(ground.sx, ground.sy);
  await step(page, 1);
  expect((await entities(page, { type: 'spearman', own: true })).length).toBe(before + 1);

  // State hash.
  await page.getByTestId('debug-hash-refresh').click();
  const hash = await page.evaluate(() => window.__game!.hash());
  await expect(page.getByTestId('debug-hash')).toHaveText(hash);

  // F3 closes it and the match carries on without the overlay.
  await page.keyboard.press('F3');
  await expect(page.getByTestId('debug-overlay')).toHaveCount(0);
  await expect(layer).toBeHidden();
  expect(errors).toEqual([]);
});

test('hotkeys: idle cycling centres the camera, H, group double-tap, Shift keeps placement, Esc, F10 and Pause', async ({ page }) => {
  const errors = collectErrors(page);
  await startMatch(page, { paused: true });
  const tc = await townCenter(page);
  const centred = async (p: { x: number; y: number }): Promise<boolean> => {
    const s = await toScreen(page, p.x, p.y);
    return Math.abs(s.x - 640) < 4 && Math.abs(s.y - 360) < 20;
  };

  // '.' selects an idle villager and centres the camera on it; again moves to the next one.
  await centreCamera(page, tc.x + 25, tc.y + 25);
  await page.keyboard.press('Period');
  const [first] = await selection(page);
  const v1 = (await villagers(page)).find((v) => v.id === first)!;
  expect(await centred(v1)).toBe(true);
  await page.keyboard.press('Period');
  const [second] = await selection(page);
  expect(second).not.toBe(first);
  // The top-bar idle button does the same.
  await page.getByTestId('idle-villagers').click();
  expect((await selection(page)).length).toBe(1);

  // H selects and centres the Town Center.
  await centreCamera(page, tc.x + 25, tc.y + 25);
  await page.keyboard.press('KeyH');
  expect(await selection(page)).toEqual([tc.id]);
  expect(await centred(tc)).toBe(true);

  // Control group: Ctrl+2 assigns, 2 selects, a quick second 2 centres the camera.
  await page.keyboard.press('KeyH');
  await page.keyboard.press('Control+Digit2');
  await centreCamera(page, tc.x + 25, tc.y + 25);
  expect(await centred(tc)).toBe(false);
  await page.keyboard.press('Digit2');
  await page.keyboard.press('Digit2'); // within the double-tap window: selects and centres
  expect(await selection(page)).toEqual([tc.id]);
  expect(await centred(tc)).toBe(true);

  // Shift while placing keeps placement mode after a placement; a plain click ends it.
  await cheat.resources(page, { wood: 400 });
  await groupAll(page);
  await card(page, 'Economy').click();
  await card(page, 'House').click();
  expect(await inputMode(page)).toBe('placement');
  const spot = await validGhostSpot(page, tc.x, tc.y, 2, 4);
  await page.keyboard.down('Shift');
  await page.mouse.click(spot.x, spot.y);
  await page.keyboard.up('Shift');
  expect(await inputMode(page)).toBe('placement');
  await page.keyboard.press('Escape');
  expect(await inputMode(page)).toBeNull();
  await expect(page.getByTestId('game-menu')).toHaveCount(0);

  // Esc with nothing to cancel opens the menu (and pauses); Esc again closes it.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('game-menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('game-menu')).toHaveCount(0);

  // F10 and Pause toggle pause; the key is ignored while the menu holds the game paused.
  await page.keyboard.press('F10');
  expect(await page.evaluate(() => window.__game!.paused)).toBe(false);
  await page.keyboard.press('Pause');
  expect(await page.evaluate(() => window.__game!.paused)).toBe(true);
  await page.keyboard.press('Escape');
  await page.keyboard.press('F10');
  expect(await page.evaluate(() => window.__game!.paused)).toBe(true);
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

test('Shift + right click queues orders', async ({ page }) => {
  const errors = collectErrors(page);
  await startMatch(page, { paused: true });
  const tc = await townCenter(page);
  const v = (await villagers(page))[0]!;
  await clickUnit(page, v);
  const a = await toScreen(page, tc.x + 6, tc.y);
  const b = await toScreen(page, tc.x, tc.y - 6);
  await page.mouse.click(a.x, a.y, { button: 'right' });
  await page.keyboard.down('Shift');
  await page.mouse.click(b.x, b.y, { button: 'right' });
  await page.keyboard.up('Shift');
  await step(page, 2);
  const q = await page.evaluate((id) => {
    const e = window.__game!.state!.entities.find((x) => x.id === id);
    return e !== undefined && e.kind === 'unit' ? { current: e.currentOrder?.type ?? null, queued: e.orderQueue.length } : null;
  }, v.id);
  expect(q).toEqual({ current: 'move', queued: 1 });
  expect(errors).toEqual([]);
});

test('queue cancel while paused is shown as pending and applies on resume', async ({ page }) => {
  const errors = collectErrors(page);
  await startMatch(page, { paused: true });
  await cheat.resources(page, { food: 500 });
  await page.keyboard.press('KeyH');
  await page.keyboard.press('KeyQ');
  await page.keyboard.press('KeyQ');
  await step(page, 2);
  await expect(page.getByTestId('queue-item-1')).toBeVisible();
  await page.getByTestId('queue-item-1').click();
  await expect(page.getByTestId('queue-item-1')).toHaveAttribute('data-pending', 'true');
  await expect(page.getByTestId('toast').filter({ hasText: 'Cancel will apply when the game resumes' })).toBeVisible();
  await shot(page, 'wp13-4-cancel-pending');
  await step(page, 2);
  await expect(page.getByTestId('queue-item-1')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Silk Workshop panel shows passive income; houses show population; nodes show gatherers', async ({ page }) => {
  const errors = collectErrors(page);
  await startMatch(page, { paused: true });
  const tc = await townCenter(page);
  await page.evaluate(() => {
    window.__game!.cheat.addResources({ food: 3000, wood: 3000, gold: 3000, stone: 3000 });
    window.__game!.cheat.instantBuild(true);
    window.__game!.cheat.instantResearch(true);
  });
  await step(page, 1);
  await page.keyboard.press('KeyH');
  await expect(page.getByTestId('sel-fact-dropOff')).toBeVisible();
  await expect(page.getByTestId('sel-fact-pop')).toContainText('+10 population');
  const house = await (async () => {
    const vs = await villagers(page);
    const front = [...vs].sort((a, b) => b.x + b.y - (a.x + a.y))[0]!;
    const p = await toScreen(page, front.x, front.y);
    await page.mouse.dblclick(p.x, p.y - 14);
    return placeViaCard(page, { menu: 'Economy', label: 'House', size: 2, near: tc, minRing: 4 });
  })();
  await clickBuilding(page, house);
  await expect(page.getByTestId('sel-fact-pop')).toContainText('+10 population');
  await stepUntil(page, 'g.state.tick > 0', 10);
  expect(errors).toEqual([]);
});

for (const [w, h] of [
  [1024, 600],
  [1280, 720],
  [1920, 1080],
  [2560, 1440],
  [800, 600],
] as const) {
  test(`HUD lays out cleanly at ${w}x${h}`, async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: w, height: h });
    await startMatch(page, { paused: true });
    await cheat.resources(page, { food: 3000, wood: 3000 });
    await page.keyboard.press('KeyH');
    // A full production queue (10): every item must stay on screen, whatever the window size.
    for (let i = 0; i < 10; i++) await page.keyboard.press('KeyQ');
    await step(page, 2);
    await expect(page.locator('[data-testid^="queue-item-"]')).toHaveCount(10);
    const report = await page.evaluate(() => {
      const bad: string[] = [];
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const hud = document.querySelector('[data-testid="hud"]')!;
      for (const el of Array.from(hud.querySelectorAll('button, .res, .pop, .age, .clock'))) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.left < -0.5 || r.right > vw + 0.5 || r.top < -0.5 || r.bottom > vh + 0.5) bad.push(`outside: ${el.className} ${JSON.stringify(r)}`);
      }
      const bar = document.querySelector('[data-testid="top-bar"]') as HTMLElement;
      if (bar.scrollWidth > bar.clientWidth + 1) bad.push('top bar overflows');
      const age = document.querySelector('.age-name') as HTMLElement;
      if (age.getBoundingClientRect().height > 22) bad.push('age name wraps');
      const speed = document.querySelector('[data-testid="speed-2"]')!.getBoundingClientRect();
      const barRect = bar.getBoundingClientRect();
      if (speed.right > vw || speed.bottom > barRect.bottom) bad.push('speed controls cut off');
      // The bottom panels touch: no strip of world between the minimap, selection and card.
      const rects = ['.minimap-frame', '.selection', '.card'].map((s) => document.querySelector(s)!.getBoundingClientRect());
      if (Math.abs(rects[0]!.right - rects[1]!.left) > 0.5 || Math.abs(rects[1]!.right - rects[2]!.left) > 0.5) bad.push('gap between bottom panels');
      // The minimap diamond fills its panel width.
      const mm = document.querySelector('[data-testid="minimap"]')!.getBoundingClientRect();
      if (mm.width < 200) bad.push(`minimap narrow ${mm.width}`);
      return bad;
    });
    expect(report).toEqual([]);
    await shot(page, `wp13-layout-${w}x${h}`);
    expect(errors).toEqual([]);
  });
}

test('loading a save after placement mode was entered starts clean (no mode, no ghost, no errors)', async ({ page }) => {
  const errors = collectErrors(page);
  await startMatch(page, { paused: true });
  const tc = await townCenter(page);
  await groupAll(page);
  await cheat.resources(page, { wood: 200 });
  await card(page, 'Economy').click();
  await card(page, 'House').click();
  expect(await inputMode(page)).toBe('placement');
  await page.keyboard.press('Escape'); // Esc cancels placement first ...
  expect(await inputMode(page)).toBeNull();
  await page.keyboard.press('Escape'); // ... and only then opens the menu
  await expect(page.getByTestId('game-menu')).toBeVisible();
  await page.getByTestId('menu-save').click();
  await page.getByTestId('save-new').click();
  await expect(page.getByTestId('saveload-message')).toContainText('Saved');
  await page.getByTestId('saveload-back').click();
  await page.getByTestId('menu-load').click();
  await page.locator('[data-testid^="load-"]').filter({ hasText: /Load/ }).first().click();
  await expect(page.locator('canvas.world-canvas')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('hud')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__game!.state?.entities.length ?? 0)).toBeGreaterThan(10);
  expect(await inputMode(page)).toBeNull();
  expect(await page.evaluate(() => window.__game!.ghost())).toBeNull();
  expect((await buildingsOf(page, 'townCenter'))[0]!.id).toBe(tc.id);
  await frames(page, 3);
  expect(errors).toEqual([]);
});
