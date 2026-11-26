/**
 * Stages scenes in the real game with the rendered art and saves screenshots (visual checks and the curated
 * gallery). Serves an e2e build itself:
 *
 *   npx vite build --mode e2e --outDir dist-e2e-art
 *   node scripts/art-shots.mjs [outDir] [scene,...]
 *
 * Scenes: start, ages (a developed town in each age), work (forest, gold, stone with villagers), army (every unit),
 * construction, zoom (0.5x / 1x / 2x). Time only moves through `__game.step`; cheats and `__art.issue` stage the
 * town (instant build and research, spawned units).
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import process from 'node:process';
import { chromium } from '@playwright/test';

const OUT = process.argv[2] ?? 'test-results/art-shots';
const ONLY = (process.argv[3] ?? '').split(',').filter(Boolean);
const PORT = Number(process.env.SHOT_PORT ?? 5497);
const DIST = process.env.ART_DIST ?? 'dist-e2e-art';
const LOCAL_CHROMIUM = '/opt/pw-browsers/chromium';
mkdirSync(OUT, { recursive: true });

const server = spawn('npx', ['vite', 'preview', '--outDir', DIST, '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
const want = (s) => ONLY.length === 0 || ONLY.includes(s);

async function waitServer() {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/`);
      if (r.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('preview server did not start');
}

const errors = [];
let page;

async function start(extra = '') {
  await page.goto(`http://localhost:${PORT}/?seed=1&paused=1&art=rendered${extra}`);
  await page.getByTestId('new-game').click();
  await page.getByTestId('start-match').click();
  await page.waitForFunction(() => window.__game?.screen === 'game' && (window.__game?.state?.entities.length ?? 0) > 10, null, { timeout: 180_000 });
  await page.evaluate(() => {
    window.__game.freezeClock();
    const g = window.__game;
    g.cheat.addResources({ food: 50000, wood: 50000, gold: 50000, stone: 50000 });
    g.cheat.instantBuild(true);
    g.cheat.instantResearch(true);
    g.step(1);
  });
}

const shot = async (name) => {
  await page.evaluate(() => window.__game.advanceClock(30000));
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('shot', name);
};

/** Place buildings near the Town Center with the villagers (instant build), stepping until done. */
async function placeTown(types) {
  return page.evaluate((list) => {
    const g = window.__game;
    const s = g.state;
    const tc = s.entities.find((e) => e.kind === 'building' && e.typeId === 'townCenter' && e.owner === 1);
    const vills = s.entities.filter((e) => e.kind === 'unit' && e.owner === 1 && e.typeId === 'villager').map((e) => e.id);
    const sizes = { townCenter: 4, house: 2, mill: 2, lumberCamp: 2, miningCamp: 2, farm: 2, barracks: 3, archeryRange: 3, stable: 3, siegeWorkshop: 3, silkWorkshop: 3 };
    const W = s.map.width;
    const occupied = (tx, ty, n) => {
      for (const e of g.state.entities) {
        if (e.kind === 'unit') continue;
        const sz = sizes[e.typeId] ?? (e.typeId.endsWith('Deposit') ? 2 : 1);
        if (tx < e.tile.tx + sz + 1 && tx + n + 1 > e.tile.tx && ty < e.tile.ty + sz + 1 && ty + n + 1 > e.tile.ty) return true;
      }
      return tx < 2 || ty < 2 || tx + n > W - 2 || ty + n > W - 2;
    };
    const placed = [];
    for (const type of list) {
      const n = sizes[type];
      let done = false;
      for (let r = 3; r < 16 && !done; r++) {
        for (let a = 0; a < 24 && !done; a++) {
          const ang = (a / 24) * Math.PI * 2 + r * 0.7;
          const tx = Math.round(tc.tile.tx + 2 + Math.cos(ang) * (r + 1) - n / 2);
          const ty = Math.round(tc.tile.ty + 2 + Math.sin(ang) * (r + 1) - n / 2);
          if (occupied(tx, ty, n)) continue;
          const before = g.state.entities.length;
          window.__art.issue({ type: 'build', unitIds: vills, buildingType: type, tx, ty, queue: false });
          g.step(1, false);
          if (g.state.entities.length > before) {
            placed.push(type);
            done = true;
            const id = Math.max(...g.state.entities.map((e) => e.id));
            for (let k = 0; k < 120; k++) {
              const b = g.state.entities.find((e) => e.id === id);
              if (b === undefined || b.constructed) break;
              g.step(5, false);
            }
          }
        }
      }
    }
    for (let i = 0; i < 60; i++) g.step(10, false);
    g.step(1);
    return placed;
  }, types);
}

async function advance(tech) {
  await page.evaluate((t) => {
    const g = window.__game;
    const tc = g.state.entities.find((e) => e.kind === 'building' && e.typeId === 'townCenter' && e.owner === 1);
    window.__art.issue({ type: 'research', buildingId: tc.id, techId: t });
    for (let i = 0; i < 5; i++) g.step(2, false);
    g.step(1);
  }, tech);
  return page.evaluate(() => window.__game.state.players[1].age);
}

async function focusTC(dx = 0, dy = 0, zoom = 1) {
  await page.evaluate(([x, y, z]) => {
    const g = window.__game;
    const tc = g.state.entities.find((e) => e.kind === 'building' && e.typeId === 'townCenter' && e.owner === 1);
    g.setZoom(z);
    // Pan by clicking the minimap at the TC (camera jump).
    const p = g.minimapToPage(tc.tile.tx + 2 + x, tc.tile.ty + 2 + y);
    window.__jump = p;
  }, [dx, dy, zoom]);
  const p = await page.evaluate(() => window.__jump);
  await page.mouse.click(p.x, p.y);
  await page.evaluate(() => window.__game.step(1));
}

try {
  await waitServer();
  const browser = await chromium.launch({
    ...(existsSync(LOCAL_CHROMIUM) ? { executablePath: LOCAL_CHROMIUM } : {}),
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  const t0 = Date.now();
  await start();
  console.log('boot ms', Date.now() - t0, JSON.stringify(await page.evaluate(() => window.__art.report())));
  if (want('start')) await shot('start');

  if (want('ages') || want('army') || want('work') || want('zoom') || want('construction')) {
    const placed = await placeTown(['house', 'house', 'mill', 'lumberCamp', 'miningCamp', 'farm', 'farm', 'barracks']);
    console.log('placed', placed.join(','));
    await focusTC();
    if (want('ages')) await shot('age1');
    await advance('townshipAge');
    await placeTown(['archeryRange', 'stable', 'house']);
    await focusTC();
    if (want('ages')) await shot('age2');
    await advance('citadelAge');
    await placeTown(['siegeWorkshop', 'silkWorkshop']);
    await focusTC();
    if (want('ages')) await shot('age3');
    await advance('empireAge');
    await focusTC();
    if (want('ages')) await shot('age4');
    if (want('zoom')) {
      for (const z of [0.5, 2]) {
        await focusTC(0, 0, z);
        await shot(`zoom${z}`);
      }
      await focusTC(0, 0, 1);
    }
    if (want('army')) {
      await page.evaluate(() => {
        const g = window.__game;
        const tc = g.state.entities.find((e) => e.kind === 'building' && e.typeId === 'townCenter' && e.owner === 1);
        const units = ['villager', 'spearman', 'swordsman', 'archer', 'siphonarios', 'horseman', 'lancer', 'cataphract', 'batteringRam', 'trebuchet'];
        units.forEach((u, i) => {
          for (let k = 0; k < 3; k++) {
            window.__art.issue({ type: 'cheat', cheat: { kind: 'spawnUnit', unitType: u, x: tc.tile.tx + 6.5 + k * 1.2, y: tc.tile.ty - 4.5 + i * 1.3 } });
          }
        });
        g.step(1);
      });
      await focusTC(5, -1, 1.5);
      await shot('army');
    }
  }
  console.log('total ms', Date.now() - t0);
  await browser.close();
} finally {
  server.kill();
  console.log(errors.length ? `console errors:\n${errors.join('\n')}` : 'no console errors');
}
