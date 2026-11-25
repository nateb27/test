import { expect, test } from '@playwright/test';
import { SHOTS } from './helpers';

test('boots to the menu, starts a match, and the sim ticks', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/?seed=1');
  await expect(page.getByTestId('main-menu')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Untitled RTS' })).toBeVisible();

  await page.getByTestId('new-game').click();
  await page.getByTestId('start-match').click();
  const canvas = page.locator('canvas.world-canvas');
  await expect(canvas).toBeVisible({ timeout: 60_000 });

  // The canvas fills the window.
  const box = await canvas.boundingBox();
  const viewport = page.viewportSize();
  expect(box?.width).toBe(viewport?.width);
  expect(box?.height).toBe(viewport?.height);

  // The fixed-tick loop advances the sim in real time.
  await expect.poll(() => page.evaluate(() => window.__game?.screen)).toBe('game');
  const t0 = await page.evaluate(() => window.__game?.state?.tick ?? -1);
  await expect.poll(() => page.evaluate(() => window.__game?.state?.tick ?? -1), { timeout: 60_000 }).toBeGreaterThan(t0 + 5);

  // step(n) fast-forwards deterministically.
  const stepped = await page.evaluate(() => {
    const g = window.__game;
    if (!g?.state) return null;
    g.setPaused(true);
    const before = g.state.tick;
    g.step(100);
    return { before, after: g.state.tick, hash: g.hash() };
  });
  expect(stepped).not.toBeNull();
  expect(stepped!.after).toBe(stepped!.before + 100);
  expect(stepped!.hash).toMatch(/^[0-9a-f]{8}$/);

  // Pause holds the tick.
  const paused = await page.evaluate(() => window.__game?.state?.tick);
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  expect(await page.evaluate(() => window.__game?.state?.tick)).toBe(paused);

  await page.screenshot({ path: `${SHOTS}/smoke-match.png` });
  expect(errors).toEqual([]);
});
