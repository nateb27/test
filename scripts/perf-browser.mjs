/**
 * WP12 browser measurements (plan 9.4). Not a CI test: run it by hand.
 *
 *   E2E_PORT=5470 node scripts/perf-browser.mjs [--skip-build] [--dir dist-perf] [--seconds 6] [--json out.json] [--no-battle]
 *
 * It builds the e2e flavour of the app (`window.__game` present) into
 * `dist-perf/`, serves it with `vite preview`, drives the real Chromium
 * (`/opt/pw-browsers/chromium` when present, same flags as playwright.config.ts)
 * and prints:
 *
 *  1. initial load: navigation start to the main menu, art generation, and the
 *     time from clicking Start Game to the first frame of the match (cold: art
 *     still generating, warm: art ready), with map generation split out;
 *  2. the stress match (200 villagers, 150 buildings, ~1,800 nodes, a scripted
 *     player) at 1x and 0.5x zoom, nothing selected and with every villager
 *     box-selected: requestAnimationFrame intervals, and the JS cost of the
 *     frame, the HUD view-model rebuild, the Preact re-render, the minimap
 *     redraws and the world overlays (from `__game.perf`).
 *
 * Caveat, also printed: a headless container has no GPU. WebGL runs on
 * SwiftShader (software), so absolute frame rates here are a floor for what a
 * real machine does; the JS-side costs are meaningful, the pixel-fill costs
 * are not. A 60 fps result on real hardware cannot be confirmed from here.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};

const PORT = Number(process.env.E2E_PORT ?? 5470);
const DIR = opt('dir', 'dist-perf');
const SECONDS = Number(opt('seconds', '6'));
const JSON_OUT = opt('json', '');
const LOCAL_CHROMIUM = '/opt/pw-browsers/chromium';
const VIEWPORT = { width: 1920, height: 1080 };

if (!flag('skip-build')) {
  console.log(`building e2e flavour into ${DIR} ...`);
  const r = spawnSync('npx', ['vite', 'build', '--mode', 'e2e', '--outDir', DIR, '--logLevel', 'error'], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

// Own process group, so the whole `npx vite preview` tree can be stopped (a plain kill leaves the node child running).
const server = spawn('npx', ['vite', 'preview', '--outDir', DIR, '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore', detached: true });
const stopServer = () => {
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    /* already gone */
  }
};
process.on('exit', stopServer);
const base = `http://127.0.0.1:${PORT}`;
for (let i = 0; ; i++) {
  try {
    if ((await fetch(base)).ok) break;
  } catch {
    /* not up yet */
  }
  if (i > 100) throw new Error('preview server did not start');
  await new Promise((r) => setTimeout(r, 200));
}

const browser = await chromium.launch({
  ...(existsSync(LOCAL_CHROMIUM) ? { executablePath: LOCAL_CHROMIUM } : {}),
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

const fmt = (n, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : 'n/a');
const report = { viewport: VIEWPORT, load: {}, stress: {} };

async function newPage() {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return { page, context, errors };
}

/** ms since navigation start at which `selector` first exists, polled every frame inside the page. */
const whenVisible = (page, selector) =>
  page.evaluate(
    (sel) =>
      new Promise((resolve) => {
        const check = () => (document.querySelector(sel) ? resolve(performance.now()) : requestAnimationFrame(check));
        check();
      }),
    selector,
  );

const measures = (page) =>
  page.evaluate(() => Object.fromEntries(performance.getEntriesByType('measure').map((m) => [m.name, m.duration])));

// ---------------------------------------------------------------------------
// 1. Initial load
// ---------------------------------------------------------------------------

async function loadTimes(warm) {
  const { page, context, errors } = await newPage();
  await page.goto(base + '/', { waitUntil: 'commit' });
  const menuAt = await whenVisible(page, '[data-testid="main-menu"]');
  if (warm) await page.waitForTimeout(6000); // let the art finish
  await page.getByTestId('new-game').click();
  await page.getByTestId('start-match').click();
  const clickedAt = await page.evaluate(() => performance.now());
  const canvasAt = await whenVisible(page, 'canvas.world-canvas');
  await page.waitForFunction(() => (window.__game?.state?.entities.length ?? 0) > 10);
  const playableAt = await page.evaluate(() => performance.now());
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const frameAt = await page.evaluate(() => performance.now());
  const m = await measures(page);
  await context.close();
  return {
    toMenuMs: menuAt,
    startToFirstFrameMs: frameAt - clickedAt,
    startToPlayableMs: playableAt - clickedAt,
    startToCanvasMs: canvasAt - clickedAt,
    mapgenMs: m['rts.mapgen'] ?? null,
    artMs: m['rts.art'] ?? null,
    errors,
  };
}

report.load.cold = await loadTimes(false);
report.load.warm = await loadTimes(true);
console.log('\n== Initial load (1920x1080, SwiftShader, localhost) ==');
for (const [k, v] of Object.entries(report.load)) {
  console.log(
    `${k.padEnd(5)} main menu ${fmt(v.toMenuMs, 0)} ms (budget 2000) | Start Game -> match running ${fmt(v.startToPlayableMs, 0)} ms (budget 3000), canvas up ${fmt(v.startToCanvasMs, 0)} ms, two frames drawn ${fmt(v.startToFirstFrameMs, 0)} ms` +
      ` | map generation ${fmt(v.mapgenMs, 0)} ms | art ${fmt(v.artMs, 0)} ms`,
  );
  if (v.errors.length > 0) console.log('  console errors:', v.errors.slice(0, 3));
}

// ---------------------------------------------------------------------------
// 2. Stress match
// ---------------------------------------------------------------------------

const { page, context, errors } = await newPage();
await page.goto(base + '/');
await page.getByTestId('main-menu').waitFor();
await page.evaluate(() => window.__game.startStress(1));
await page.waitForFunction(() => window.__game?.screen === 'game' && (window.__game.state?.entities.length ?? 0) > 1000, null, { timeout: 60_000 });
await page.getByTestId('minimap').waitFor();
await page.waitForTimeout(3000); // warm up: the first ticks are the 200-unit path burst, terrain chunks bake

const counts = await page.evaluate(() => {
  const c = { unit: 0, building: 0, node: 0 };
  for (const e of window.__game.state.entities) c[e.kind]++;
  return c;
});
console.log(`\n== Stress match: ${counts.unit} units, ${counts.building} buildings, ${counts.node} nodes ==`);

/** Record rAF intervals and perf counters for `ms` of wall time. */
async function sample(label, ms) {
  await page.evaluate(() => {
    window.__game.perf.enable(true);
    window.__game.perf.reset();
    window.__rafStamps = [];
    const loop = (t) => {
      window.__rafStamps.push(t);
      if (window.__rafRun) requestAnimationFrame(loop);
    };
    window.__rafRun = true;
    requestAnimationFrame(loop);
  });
  const tick0 = await page.evaluate(() => window.__game.state.tick);
  await page.waitForTimeout(ms);
  const out = await page.evaluate(() => {
    window.__rafRun = false;
    const t = window.__rafStamps;
    const dts = [];
    for (let i = 1; i < t.length; i++) dts.push(t[i] - t[i - 1]);
    return { dts, perf: window.__game.perf.snapshot(), tick: window.__game.state.tick };
  });
  await page.evaluate(() => window.__game.perf.enable(false));
  const dts = [...out.dts].sort((a, b) => a - b);
  const avg = dts.reduce((a, b) => a + b, 0) / dts.length;
  const q = (p) => dts[Math.min(dts.length - 1, Math.floor(dts.length * p))];
  const secs = ms / 1000;
  const result = {
    frames: dts.length,
    fps: dts.length / secs,
    frameAvgMs: avg,
    frameP50Ms: q(0.5),
    frameP95Ms: q(0.95),
    frameMaxMs: dts[dts.length - 1],
    ticksRun: out.tick - tick0,
    ticksExpected: secs * 20,
    paused: await page.evaluate(() => window.__game.paused),
    perf: out.perf,
  };
  report.stress[label] = result;
  const p = out.perf;
  const per = (name, perSec = false) =>
    p[name] === undefined ? 'n/a' : perSec ? `${fmt(p[name].totalMs / secs, 1)} ms/s (${fmt(p[name].avgMs, 2)} avg x ${p[name].count})` : `${fmt(p[name].avgMs, 2)} avg / ${fmt(p[name].maxMs, 1)} max (x${p[name].count})`;
  console.log(`\n-- ${label} --`);
  console.log(
    `rAF: ${fmt(result.fps, 1)} fps, interval avg ${fmt(avg)} ms, p50 ${fmt(result.frameP50Ms)}, p95 ${fmt(result.frameP95Ms)}, max ${fmt(result.frameMaxMs)} | sim ticks ${result.ticksRun}/${fmt(result.ticksExpected, 0)} expected${result.paused ? ' (PAUSED)' : ''}`,
  );
  console.log(`entities drawn/frame ${fmt(p['count.drawn']?.avgMs, 0)} (sum of counts / frames)`);
  console.log(`per frame (JS): input ${per('frame.input')} | render ${per('frame.render')} (terrain ${per('render.terrain')}, entities ${per('render.entities')}) | overlays ${per('frame.overlays')} | total ${per('frame.js')}`);
  console.log(`Pixi draw (JS side of scene traversal + GL submission) ${per('pixi.render')}`);
  console.log(`sim tick ${per('sim.step')} | tick listeners ${per('sim.listeners')}`);
  console.log(`HUD: view-model build ${per('hud.build')} total ${per('hud.build', true)} | notify ${per('hud.notify')} | Preact re-render ${per('hud.preact')} total ${per('hud.preact', true)}`);
  console.log(`minimap: units layer ${per('minimap.main')} | statics ${per('minimap.statics')} | outline redraw ${per('minimap.outline')}`);
  return result;
}

async function boxSelectAll() {
  await page.mouse.move(20, 60);
  await page.mouse.down();
  await page.mouse.move(VIEWPORT.width - 20, VIEWPORT.height - 260, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  return page.evaluate(() => window.__game.selection.length);
}

for (const zoom of [1, 0.5]) {
  await page.evaluate((z) => window.__game.setZoom(z), zoom);
  await page.waitForTimeout(500);
  await sample(`${zoom}x zoom, nothing selected`, SECONDS * 1000);
  const n = await boxSelectAll();
  if (zoom === 1) await page.screenshot({ path: 'test-results/perf-stress-1x.png' });
  else await page.screenshot({ path: 'test-results/perf-stress-0.5x.png' });
  await sample(`${zoom}x zoom, ${n} selected`, SECONDS * 1000);
  // Deselect by clicking open ground at the right edge (Escape would open the pause menu).
  await page.mouse.click(VIEWPORT.width - 30, VIEWPORT.height / 2);
  await page.evaluate(() => window.__game.setPaused(false));
}

if (errors.length > 0) console.log('\nconsole errors:', errors.slice(0, 5));
await context.close();

// ---------------------------------------------------------------------------
// 3. Battle (PLAN-M2 8.4, WP33): 200 soldiers a side attack-moving into each other, health bars and projectiles on.
//    Skipped with --no-battle. The fight is decided within about 30 s of game time, so it samples 5 s at each zoom.
// ---------------------------------------------------------------------------

if (!flag('no-battle')) {
  const b = await newPage();
  await b.page.goto(base + '/');
  await b.page.getByTestId('main-menu').waitFor();
  await b.page.evaluate(() => window.__game.startBattle(1, 200));
  await b.page.waitForFunction(() => window.__game?.screen === 'game' && (window.__game.state?.entities.filter((e) => e.kind === 'unit').length ?? 0) > 300, null, {
    timeout: 60_000,
  });
  await b.page.getByTestId('minimap').waitFor();
  await b.page.evaluate(() => window.__game.setPaused(false));
  report.battle = {};
  const battleSample = async (label, ms) => {
    await b.page.evaluate(() => {
      window.__rafStamps = [];
      const loop = (t) => {
        window.__rafStamps.push(t);
        if (window.__rafRun) requestAnimationFrame(loop);
      };
      window.__rafRun = true;
      requestAnimationFrame(loop);
    });
    const tick0 = await b.page.evaluate(() => window.__game.state.tick);
    await b.page.waitForTimeout(ms);
    const out = await b.page.evaluate(() => {
      window.__rafRun = false;
      const t = window.__rafStamps;
      const dts = [];
      for (let i = 1; i < t.length; i++) dts.push(t[i] - t[i - 1]);
      const units = window.__game.state.entities.filter((e) => e.kind === 'unit').length;
      return { dts, tick: window.__game.state.tick, units, projectiles: window.__game.state.projectiles.length };
    });
    const dts = [...out.dts].sort((x, y) => x - y);
    const q = (p) => dts[Math.min(dts.length - 1, Math.floor(dts.length * p))];
    const r = { fps: dts.length / (ms / 1000), frameP50Ms: q(0.5), frameP95Ms: q(0.95), ticksRun: out.tick - tick0, units: out.units, projectiles: out.projectiles };
    report.battle[label] = r;
    console.log(
      `-- battle, ${label}: ${fmt(r.fps, 1)} fps, frame p50 ${fmt(r.frameP50Ms)} ms, p95 ${fmt(r.frameP95Ms)} ms | sim ticks ${r.ticksRun}/${fmt((ms / 1000) * 20, 0)} | ${r.units} units, ${r.projectiles} projectiles in flight`,
    );
  };
  console.log('\n== Battle: 200 a side (plan 8.4: 60 fps at 1x, >= 45 at 0.5x on real hardware) ==');
  for (const zoom of [1, 0.5]) {
    await b.page.evaluate((z) => window.__game.setZoom(z), zoom);
    await b.page.waitForTimeout(300);
    await battleSample(`${zoom}x zoom`, Math.min(SECONDS, 5) * 1000);
  }
  if (b.errors.length > 0) console.log('\nconsole errors:', b.errors.slice(0, 5));
  await b.context.close();
}

await browser.close();
stopServer();

console.log(
  '\nCaveat: headless Chromium here has no GPU (SwiftShader software GL, one shared CPU). Frame intervals and Pixi draw time are dominated by\n' +
    'software rasterisation and are only a floor for real hardware; the JS-side costs (render, overlays, HUD, minimap, sim) are the\n' +
    'comparable numbers. This run cannot confirm 60 fps at 1x or 45 fps at 0.5x on a real machine.',
);
if (JSON_OUT !== '') writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
