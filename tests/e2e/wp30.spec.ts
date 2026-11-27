import { expect, test } from '@playwright/test';
import { collectErrors, frames, shot, startMatch, step, waitForMatch } from './helpers';

/** WP30: the match setup screen, the end screen, AI controllers and save/load with controller memory. */

test('scenario 1: setup screen: Hard, red for the human, seed 7', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?paused=1');
  await expect(page.getByTestId('main-menu')).toBeVisible();
  await page.getByTestId('new-game').click();
  await expect(page.getByTestId('setup-screen')).toBeVisible();
  await expect(page.getByTestId('civ-panel')).toBeVisible();
  // The e2e build defaults to "No opponent"; the colours default to blue (you) and red (opponent).
  await expect(page.getByTestId('setup-opponent-none')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('setup-opponent-hard').click();
  await expect(page.getByTestId('setup-opponent-hard')).toHaveAttribute('aria-checked', 'true');
  // Two players cannot share a colour: the other player's swatch is disabled.
  await expect(page.getByTestId('setup-color-1-red')).toBeDisabled();
  await expect(page.getByTestId('setup-color-2-blue')).toBeDisabled();
  await page.getByTestId('setup-color-2-green').click();
  await page.getByTestId('setup-color-1-red').click();
  await page.getByTestId('setup-color-2-blue').click();
  await expect(page.getByTestId('setup-color-1-red')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('setup-color-2-blue')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('setup-seed').fill('7');
  await shot(page, 'wp30-1-setup');
  await page.getByTestId('start-match').click();
  await waitForMatch(page);

  const m = await page.evaluate(() => {
    const g = window.__game!;
    const s = g.state!;
    return {
      mapSeed: s.seed,
      tcs: s.entities.filter((e) => e.kind === 'building' && e.typeId === 'townCenter').map((e) => e.owner),
      colors: s.players.slice(1).map((p) => p.color),
      controllers: s.players.slice(1).map((p) => [p.controller, p.difficulty]),
      mode: g.match()!.mode,
      aiEnabled: g.ai.enabled(),
      memory: g.ai.memory(2),
    };
  });
  expect(m.mapSeed).toBe(7);
  expect(m.tcs.sort()).toEqual([1, 2]);
  expect(m.colors).toEqual([0xc62f2f, 0x2f6bd8]); // red human, blue opponent
  expect(m.controllers).toEqual([['human', null], ['ai', 'hard']]);
  expect(m.mode).toBe('conquest');
  expect(m.aiEnabled).toBe(true);
  expect(m.memory).not.toBeUndefined();
  await shot(page, 'wp30-1-match');
  expect(errors).toEqual([]);
});

test('setup: No opponent is a one-player sandbox; ?opponent, ?ai=off and ?color are honoured', async ({ page }) => {
  const errors = collectErrors(page);
  await startMatch(page);
  expect(await page.evaluate(() => ({ n: window.__game!.state!.players.length, mode: window.__game!.match()!.mode, color: window.__game!.state!.players[1]!.color }))).toEqual({
    n: 2,
    mode: 'sandbox',
    color: 0x2f6bd8,
  });
  expect(await page.evaluate(() => window.__game!.localPlayerId)).toBe(1);

  await startMatch(page, { opponent: 'easy', ai: 'off', color: 'green' });
  const m = await page.evaluate(() => ({
    mode: window.__game!.match()!.mode,
    colors: window.__game!.state!.players.slice(1).map((p) => p.color),
    ai: window.__game!.ai.enabled(),
  }));
  expect(m).toEqual({ mode: 'conquest', colors: [0x3a9a3a, 0xc62f2f], ai: false });
  await page.evaluate(() => window.__game!.ai.setEnabled(true));
  expect(await page.evaluate(() => window.__game!.ai.enabled())).toBe(true);
  expect(errors).toEqual([]);
});

test('scenario 13 (screen half): a defeated local player sees the defeat end screen with stats; Main menu returns', async ({ page }) => {
  const errors = collectErrors(page);
  await startMatch(page, { opponent: 'standard', ai: 'off' });
  await page.evaluate(() => window.__game!.cheat.defeat(1));
  await step(page, 3);
  await expect(page.getByTestId('end-screen')).toBeVisible();
  await expect(page.getByTestId('end-title')).toHaveText('Defeat');
  expect(await page.evaluate(() => window.__game!.endScreen()?.result)).toBe('defeat');
  await expect(page.getByTestId('end-stats')).toBeVisible();
  await expect(page.getByTestId('end-player-1')).toContainText('(you)');
  await expect(page.getByTestId('end-player-2')).toContainText('Computer (Standard)');
  await expect(page.getByTestId('end-unitsTrained-1')).toHaveText('0');
  // The loop paused for the screen.
  expect(await page.evaluate(() => window.__game!.paused)).toBe(true);
  await shot(page, 'wp30-13-defeat');
  await page.getByTestId('end-main-menu').click();
  await expect(page.getByTestId('main-menu')).toBeVisible();
  expect(await page.evaluate(() => window.__game!.screen)).toBe('menu');
  expect(errors).toEqual([]);
});

test('scenario 13: menu, Resign, Yes: the defeat end screen with stats; Main menu returns', async ({ page }) => {
  const errors = collectErrors(page);
  await startMatch(page, { opponent: 'standard', ai: 'off' });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('game-menu')).toBeVisible();
  await page.getByTestId('game-menu').getByRole('button', { name: 'Resign' }).click();
  await expect(page.getByText('Resign this match?')).toBeVisible();
  await page.getByRole('button', { name: 'Yes' }).click();
  await step(page, 3);
  await expect(page.getByTestId('end-screen')).toBeVisible();
  await expect(page.getByTestId('end-title')).toHaveText('Defeat');
  expect(await page.evaluate(() => window.__game!.endScreen()?.reason)).toBe('resigned');
  // Hotkeys do not reach the game behind the end screen: Pause does not resume it, Esc opens no menu.
  await page.keyboard.press('Pause');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.__game!.paused)).toBe(true);
  await expect(page.getByTestId('game-menu')).toHaveCount(0);
  await shot(page, 'wp30-13-resign');
  await page.getByTestId('end-main-menu').click();
  await expect(page.getByTestId('main-menu')).toBeVisible();
  expect(errors).toEqual([]);
});

test('scenario 14: the opponent is defeated: the victory screen; View map resumes', async ({ page }) => {
  const errors = collectErrors(page);
  await startMatch(page, { opponent: 'standard', ai: 'off' });
  await page.evaluate(() => window.__game!.cheat.defeat(2));
  await step(page, 3);
  expect(await page.evaluate(() => window.__game!.match()!.winner)).toBe(1);
  await expect(page.getByTestId('end-screen')).toBeVisible();
  await expect(page.getByTestId('end-title')).toHaveText('Victory');
  expect(await page.evaluate(() => window.__game!.endScreen()?.result)).toBe('victory');
  expect(await page.evaluate(() => window.__game!.paused)).toBe(true);
  await shot(page, 'wp30-14-victory');
  await page.getByTestId('end-view-map').click();
  await expect(page.getByTestId('end-screen')).toHaveCount(0);
  expect(await page.evaluate(() => window.__game!.endScreen())).toBeNull();
  expect(await page.evaluate(() => window.__game!.paused)).toBe(false);
  // The match goes on, and the screen does not come back.
  await frames(page, 2);
  await step(page, 20);
  await expect(page.getByTestId('end-screen')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('scenario 15: save mid-battle with the AI on, step, load, step: the hashes match', async ({ page }) => {
  const errors = collectErrors(page);
  await startMatch(page, { opponent: 'standard' });
  expect(await page.evaluate(() => window.__game!.ai.enabled())).toBe(true);
  await step(page, 3000);
  const memoryAtSave = await page.evaluate(() => JSON.stringify(window.__game!.ai.memory(2)));

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('game-menu')).toBeVisible();
  await page.getByTestId('menu-save').click();
  await page.getByTestId('save-new').click();
  await expect(page.getByTestId('saveload-message')).toContainText('Saved');
  await page.getByTestId('saveload-back').click();
  await page.getByTestId('menu-resume').click();

  await step(page, 400);
  const a = await page.evaluate(() => ({ hash: window.__game!.hash(), tick: window.__game!.state!.tick, memory: JSON.stringify(window.__game!.ai.memory(2)) }));
  expect(a.tick).toBe(3400);

  await page.keyboard.press('Escape');
  await page.getByTestId('menu-load').click();
  await page.locator('[data-testid^="load-save-"]').first().click();
  // The old match is still on screen until the loading screen has replaced it: wait for the loaded tick.
  await expect.poll(() => page.evaluate(() => (window.__game!.screen === 'game' ? window.__game!.state?.tick : null)), { timeout: 60_000 }).toBe(3000);
  await waitForMatch(page);
  const loaded = await page.evaluate(() => ({ tick: window.__game!.state!.tick, memory: JSON.stringify(window.__game!.ai.memory(2)) }));
  expect(loaded.tick).toBe(3000);
  expect(loaded.memory).toBe(memoryAtSave);
  await step(page, 400);
  const b = await page.evaluate(() => ({ hash: window.__game!.hash(), tick: window.__game!.state!.tick, memory: JSON.stringify(window.__game!.ai.memory(2)) }));
  expect(b).toEqual(a);
  expect(errors).toEqual([]);
});

test('startBattle loads the battle scene through the loading screen', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?paused=1');
  await expect(page.getByTestId('main-menu')).toBeVisible();
  await page.evaluate(() => window.__game!.startBattle(1, 40));
  await expect.poll(() => page.evaluate(() => window.__game!.screen), { timeout: 60_000 }).toBe('game');
  await waitForMatch(page);
  const counts = await page.evaluate(() => {
    const units = window.__game!.state!.entities.filter((e) => e.kind === 'unit' && e.typeId !== 'villager');
    return [1, 2].map((o) => units.filter((u) => u.owner === o).length);
  });
  expect(counts).toEqual([40, 40]);
  await step(page, 20);
  await shot(page, 'wp30-battle');
  expect(errors).toEqual([]);
});
