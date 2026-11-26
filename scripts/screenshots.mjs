/**
 * Regenerates the curated gallery in docs/screenshots/ (12 images of the current game).
 *
 *   E2E_PORT=5480 npm run e2e          # leaves its screenshots in the git-ignored test-results/screenshots/
 *   node scripts/screenshots.mjs       # menu and civ select are captured here; the rest are copied from that run
 *
 * With the rendered art (the curated set): run the scenarios with `E2E_ART=rendered` (and the default port, or
 * point SRC at that port's folder), then `E2E_ART=rendered node scripts/screenshots.mjs`.
 *
 * The in-match images come from the e2e scenarios (real UI, real sim); this script only adds the two menu
 * screens, which no scenario photographs. It serves dist-e2e/ itself on a free port (build it first with
 * `npx vite build --mode e2e --outDir dist-e2e`, which the e2e run does).
 */

import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import process from 'node:process';
import { chromium } from '@playwright/test';

const OUT = 'docs/screenshots';
const SRC = process.env.SHOT_SRC ?? 'test-results/screenshots';
const PORT = Number(process.env.SHOT_PORT ?? 5481);
const LOCAL_CHROMIUM = '/opt/pw-browsers/chromium';

/** [output name, source file in test-results/screenshots or null when captured here] */
const PLAN = [
  ['01-main-menu', null],
  ['02-civ-select', null],
  ['03-match-start', 'p1-01-match-start'],
  ['04-gathering', 's03-2-carrying'],
  ['05-building-placement', 's04-4-ghost-green'],
  ['06-production-and-rally', 's05-2-training'],
  ['07-township-age', 's08-2-township'],
  ['08-citadel-age', 's08-3-citadel'],
  ['09-empire-age-objective', 's08-6-objective-banner'],
  ['10-byzantine-uniques', 's08-4-stable-cataphract'],
  ['11-minimap', 'wp10-04-minimap-full-view'],
  ['12-debug-overlay', 'wp13-3-debug-overlay'],
];

const files = existsSync(SRC) ? readdirSync(SRC) : [];
const find = (stem) => files.find((f) => f === `${stem}.png`);
const missing = PLAN.filter(([, stem]) => stem !== null && find(stem) === undefined).map(([, stem]) => stem);
if (missing.length > 0) {
  console.error(`Missing e2e screenshots (run the e2e suite first): ${missing.join(', ')}`);
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const [name, stem] of PLAN) if (stem !== null) copyFileSync(`${SRC}/${find(stem)}`, `${OUT}/${name}.png`);

const server = spawn('npx', ['vite', 'preview', '--outDir', 'dist-e2e', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
try {
  await new Promise((r) => setTimeout(r, 2500));
  const browser = await chromium.launch({
    ...(existsSync(LOCAL_CHROMIUM) ? { executablePath: LOCAL_CHROMIUM } : {}),
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(`http://localhost:${PORT}/${process.env.E2E_ART ? `?art=${process.env.E2E_ART}` : ''}`);
  await page.getByTestId('main-menu').waitFor();
  await page.screenshot({ path: `${OUT}/01-main-menu.png` });
  await page.getByTestId('new-game').click();
  await page.getByTestId('start-match').waitFor();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/02-civ-select.png` });
  await browser.close();
} finally {
  server.kill();
}
console.log(`Wrote ${PLAN.length} images to ${OUT}/`);
