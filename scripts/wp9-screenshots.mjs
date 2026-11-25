/**
 * WP9 visual proof: screenshots of the menus and the HUD at 1280x720 into
 * docs/screenshots/wp9/. Starts its own Vite dev server on a free port in
 * 5400-5449 and uses the Chromium settings from playwright.config.ts.
 *
 *   node scripts/wp9-screenshots.mjs
 *
 * The real match runs the stubbed sim systems (availability says "nothing is
 * available"), so the states that need real rules (build menu, queue, tooltip,
 * toast) are also captured from the HUD dev page, which uses a fake
 * `availability` over a fixture state.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import net from 'node:net';
import process from 'node:process';
import { chromium } from '@playwright/test';

const OUT = 'docs/screenshots/wp9';
const LOCAL_CHROMIUM = '/opt/pw-browsers/chromium';

function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, '127.0.0.1');
  });
}

async function pickPort() {
  for (let p = 5400; p <= 5449; p++) if (await portFree(p)) return p;
  throw new Error('no free port in 5400-5449');
}

async function waitForServer(url) {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('dev server did not start');
}

const port = await pickPort();
const base = `http://127.0.0.1:${port}`;
const server = spawn('npx', ['vite', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore' });
const stop = () => server.kill('SIGTERM');
process.on('exit', stop);

mkdirSync(OUT, { recursive: true });
let browser;
try {
  await waitForServer(base);
  const executablePath = existsSync(LOCAL_CHROMIUM) ? LOCAL_CHROMIUM : undefined;
  browser = await chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });

  // --- Real app: menus ---
  await page.goto(base + '/');
  await page.getByTestId('main-menu').waitFor();
  await page.waitForTimeout(1500); // let the background art generation finish
  await shot('01-main-menu');
  await page.getByTestId('new-game').click();
  await page.getByTestId('civ-select').waitFor();
  await page.waitForTimeout(300);
  await shot('02-civ-select');

  // --- Real app: the match ---
  await page.getByTestId('start-match').click();
  await page.locator('canvas.world-canvas').waitFor({ timeout: 20_000 });
  await page.waitForFunction(() => (window.__game?.state?.entities.length ?? 0) > 10);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(600);
  const v = await page.evaluate(() => {
    const e = window.__game.state.entities.find((x) => x.kind === 'unit' && x.owner === 1 && x.typeId === 'villager');
    return window.__game.worldToScreen(e.pos.x, e.pos.y - 0.2);
  });
  await page.mouse.click(v.x, v.y - 12);
  await page.waitForTimeout(300);
  await shot('03-match-villager-selected');
  await page.getByTestId('slot-0').click();
  await page.waitForTimeout(200);
  await shot('04-match-build-menu');
  await page.keyboard.press('Escape');
  await page.getByTestId('game-menu').waitFor();
  await page.waitForTimeout(200);
  await shot('05-pause-menu');
  await page.getByTestId('menu-save').click();
  await page.getByTestId('save-new').click();
  await page.getByTestId('saveload-message').waitFor();
  await shot('06-save-dialog');

  // --- HUD dev page: states that need real rules ---
  await page.goto(base + '/src/client/ui/dev/hud.html');
  await page.waitForFunction(() => window.__hudDev !== undefined, undefined, { timeout: 20_000 });
  const ids = await page.evaluate(() => {
    const fx = window.__hudDev.fx;
    return { v: fx.villagers[1], tc: fx.townCenter, sp: fx.spearman, fd: fx.foundation, all: [...fx.villagers, fx.spearman] };
  });
  await page.evaluate((id) => window.__hudDev.select([id]), ids.v);
  await page.getByTestId('slot-0').click();
  await page.mouse.move(640, 300);
  await page.waitForTimeout(250);
  await shot('07-hud-villager-build-menu');

  await page.evaluate((id) => window.__hudDev.select([id]), ids.tc);
  await page.waitForTimeout(250);
  await shot('08-hud-town-center-queue');

  await page.getByTestId('slot-5').hover(); // Hand Carts
  await page.waitForTimeout(250);
  await shot('09-hud-tooltip');

  await page.mouse.move(640, 300);
  await page.evaluate((id) => window.__hudDev.select([id]), ids.v);
  await page.getByTestId('slot-0').click();
  await page.getByTestId('slot-5').hover(); // Silk Workshop: greyed, needs the Citadel Age
  await page.waitForTimeout(250);
  await shot('10-hud-tooltip-requirements');

  await page.mouse.move(640, 300);
  await page.evaluate(() => {
    window.__hudDev.emit([
      { type: 'CommandRejected', playerId: 1, seq: 1, commandType: 'build', reason: 'cannotAfford', shortfall: { food: 0, wood: 12, gold: 0, stone: 0 } },
      { type: 'PopulationCapped', playerId: 1, buildingId: 1, unitType: 'villager' },
      { type: 'BuildingCompleted', playerId: 1, buildingId: 9, buildingType: 'mill' },
    ]);
  });
  await page.waitForTimeout(250);
  await shot('11-hud-toasts');

  await page.evaluate((all) => window.__hudDev.select(all), ids.all);
  await page.evaluate(() => {
    window.__hudDev.emit([{ type: 'AgeAdvanced', playerId: 1, age: 3 }]);
  });
  await page.waitForTimeout(700);
  await shot('12-hud-multi-selection-banner');

  await page.evaluate((id) => window.__hudDev.select([id]), ids.fd);
  await page.waitForTimeout(250);
  await shot('13-hud-unfinished-building');

  // Readability at 1920x1080.
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.evaluate((id) => window.__hudDev.select([id]), ids.tc);
  await page.waitForTimeout(500);
  await shot('14-hud-1920x1080');

  if (errors.length > 0) console.warn('Browser errors:\n' + errors.join('\n'));
  console.log(`Screenshots written to ${OUT}/`);
} finally {
  await browser?.close();
  stop();
}
