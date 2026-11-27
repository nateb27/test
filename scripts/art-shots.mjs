/**
 * Stages scenes in the real game with the rendered art and saves screenshots (visual checks and the curated
 * gallery). Serves an e2e build itself:
 *
 *   npx vite build --mode e2e --outDir dist-e2e-art
 *   node scripts/art-shots.mjs [outDir] [scene,...]
 *
 * It refuses to run (exit 1) when SHOT_PORT (default 5497) is already taken, the build is missing, or its own preview
 * server exits or reports an error while starting, so it can never photograph another (older) server's build.
 *
 * Scenes: start, ages (a developed town in each age), work (forest, gold, stone with villagers), army (every unit),
 * construction, zoom (0.5x / 1x / 2x); for the pre-rendered unit and tree sheets: lineup (all ten units in blue and
 * red, on open grass and by the Town Center, 1x, 1.5x and 2x), jobs (villagers on every job and carrying every resource), forest
 * (woodcutters at a forest edge), anims (attack / death / corpse previews of every unit), scale (units by buildings); battle (WP27 effects: a two-player fight
 * with arrows in flight, corpses, burning buildings and rubble at 0.5x / 1x / 2x). Time only moves through `__game.step`; cheats and `__art.issue` stage the
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

const want = (s) => ONLY.length === 0 || ONLY.includes(s);

/** Is anything answering on the port? */
async function answers() {
  try {
    await fetch(`http://localhost:${PORT}/`);
    return true;
  } catch {
    return false;
  }
}

// Fail loudly rather than photograph the wrong build: the port must be free before our own preview server starts (a
// server already there, perhaps of an older build, would answer the requests instead), the build must exist, and the
// server must not exit or report an error while starting.
if (!existsSync(`${DIST}/index.html`)) {
  console.error(`art-shots: no build in ${DIST}; run: npx vite build --mode e2e --outDir ${DIST}`);
  process.exit(1);
}
if (await answers()) {
  console.error(`art-shots: port ${PORT} is already in use by another server; free it or set SHOT_PORT`);
  process.exit(1);
}
const server = spawn('npx', ['vite', 'preview', '--outDir', DIST, '--port', String(PORT), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
let serverExit = null;
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));
server.on('exit', (code, signal) => (serverExit = { code, signal }));

async function waitServer() {
  for (let i = 0; i < 150; i++) {
    if (serverExit !== null) throw new Error(`preview server exited while starting (${JSON.stringify(serverExit)}):\n${serverLog}`);
    if (/error/i.test(serverLog)) throw new Error(`preview server reported an error:\n${serverLog}`);
    // Ours is up once it says so on its own output and the port answers (a stranger on the port was ruled out above).
    if (serverLog.includes(`:${PORT}`) && (await answers())) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`preview server did not start on port ${PORT}:\n${serverLog}`);
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
  await start(process.env.ART_QUERY ?? '');
  console.log('boot ms', Date.now() - t0, JSON.stringify(await page.evaluate(() => window.__art.report())));
  if (want('start')) await shot('start');

  if (want('ages') || want('army') || want('work') || want('zoom') || want('construction')) {
    await page.waitForFunction(() => window.__art?.report()?.complete === true, null, { timeout: 300_000 });
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
  const UNITS = ['villager', 'spearman', 'swordsman', 'archer', 'siphonarios', 'horseman', 'lancer', 'cataphract', 'batteringRam', 'trebuchet'];
  const BLUE = 0x2f5fbf;
  const RED = 0xc0392b;
  /** Spawn units at world points, return their ids (newest entities). */
  async function spawn(list) {
    return page.evaluate((items) => {
      const g = window.__game;
      const before = new Set(g.state.entities.map((e) => e.id));
      for (const [u, x, y] of items) window.__art.issue({ type: 'cheat', cheat: { kind: 'spawnUnit', unitType: u, x, y } });
      g.step(1);
      return g.state.entities.filter((e) => !before.has(e.id) && e.kind === 'unit').map((e) => e.id);
    }, list);
  }
  async function tcTile() {
    return page.evaluate(() => {
      const tc = window.__game.state.entities.find((e) => e.kind === 'building' && e.typeId === 'townCenter' && e.owner === 1);
      return { x: tc.tile.tx + 2, y: tc.tile.ty + 2 };
    });
  }
  /** Open grass near the Town Center: a strip `len` tiles long (screen-horizontal) and `depth` tiles deep, clear of
   * buildings, nodes and the map edge. */
  async function openStrip(len, depth, from = 10) {
    return page.evaluate(([n, d, d0]) => {
      const s = window.__game.state;
      const tc = s.entities.find((e) => e.kind === 'building' && e.typeId === 'townCenter' && e.owner === 1);
      const c = { x: tc.tile.tx + 2, y: tc.tile.ty + 2 };
      const blocked = (x, y, r) => s.entities.some((e) => e.kind !== 'unit' && Math.hypot(e.tile.tx + 0.5 - x, e.tile.ty + 0.5 - y) < r);
      for (let dist = d0; dist < 45; dist++)
        for (let a = 0; a < 40; a++) {
          const x = c.x + Math.cos((a / 40) * Math.PI * 2) * dist;
          const y = c.y + Math.sin((a / 40) * Math.PI * 2) * dist;
          let ok = x > 14 && y > 14 && x < s.map.width - 14 && y < s.map.height - 14;
          for (let k = -2; k <= n + 2 && ok; k++) for (let j = -1; j <= d + 1 && ok; j++) ok = !blocked(x + k * 0.7 + j * 0.7, y - k * 0.7 + j * 0.7, 2.2);
          if (ok) return { x, y };
        }
      return null;
    }, [len, depth, from]);
  }
  /** Walk units a step in a world direction so they face it (spawned units face +x), then let them stop. */
  async function turn(ids, dx, dy) {
    await page.evaluate(([list, ddx, ddy]) => {
      const g = window.__game;
      for (const id of list) {
        const e = g.state.entities.find((x) => x.id === id);
        if (e !== undefined) window.__art.issue({ type: 'move', unitIds: [id], x: e.pos.x + ddx, y: e.pos.y + ddy, queue: false });
      }
      for (let i = 0; i < 12; i++) g.step(5, false);
      g.step(1);
    }, [ids, dx, dy]);
  }
  async function lookAt(x, y, zoom) {
    const tc = await tcTile();
    await focusTC(x - tc.x, y - tc.y, zoom);
  }
  const extraScenes = ['lineup', 'jobs', 'forest', 'anims', 'scale'].filter((s) => ONLY.includes(s));
  if (extraScenes.length > 0) {
    const tc = await tcTile();
    if (want('lineup')) {
      // Ten unit types in blue (back row) and red (front row): on open grass, then on the Town Center's worn-earth
      // apron (before the town is built up around it).
      const strip = await openStrip(16, 3);
      const spots = { grass: strip === null ? null : { x: strip.x + 4.5, y: strip.y - 4.5 }, dirt: { x: tc.x + 1.0, y: tc.y + 4.6 } };
      for (const [tag, at] of [['grass', spots.grass], ['town', spots.dirt]]) {
        if (at === null) continue;
        const items = [];
        let k = 0;
        UNITS.forEach((u) => {
          const w = u === 'batteringRam' || u === 'trebuchet' ? 2.2 : u === 'horseman' || u === 'lancer' || u === 'cataphract' ? 1.5 : 1.0;
          k += w / 2;
          items.push([u, at.x + k - 4.5, at.y - k + 4.5]);
          items.push([u, at.x + k - 4.5 + 1.6, at.y - k + 4.5 + 1.6]);
          k += w / 2;
        });
        const ids = await spawn(items);
        await page.evaluate(([list, b, r]) => {
          list.forEach((id, n) => window.__art.colour(id, n % 2 === 0 ? b : r));
          window.__game.step(1);
        }, [ids, BLUE, RED]);
        // Three-quarter view (facing south-west) shows every silhouette best.
        await turn(ids, 0, 0.6);
        for (const z of [1, 1.5, 2]) {
          await lookAt(at.x + 2.6, at.y - 2.0, z);
          await shot(`lineup-${tag}-${z}x`);
        }
        // Remove the line-up so later scenes start from the same town.
        await page.evaluate((list) => {
          window.__art.issue({ type: 'delete', entityIds: list });
          window.__game.step(1);
        }, ids);
      }
    }
    if (!want('ages') && extraScenes.some((x) => x !== 'lineup')) await placeTown(['house', 'mill', 'lumberCamp', 'miningCamp', 'farm', 'barracks']);
    if (want('jobs')) {
      const ids = await spawn(Array.from({ length: 12 }, (_, i) => ['villager', tc.x - 3 + (i % 4), tc.y + 4 + Math.floor(i / 4)]));
      await page.evaluate((vs) => {
        const g = window.__game;
        const s = g.state;
        const near = (pred) => s.entities.filter(pred).sort((a, b) => Math.hypot(a.tile.tx - vs.x, a.tile.ty - vs.y) - Math.hypot(b.tile.tx - vs.x, b.tile.ty - vs.y))[0];
        const v = vs.ids;
        const t = { wood: near((e) => e.kind === 'node' && e.typeId === 'tree'), food: near((e) => e.kind === 'node' && e.typeId === 'berryBush'),
          gold: near((e) => e.kind === 'node' && e.typeId === 'goldDeposit'), stone: near((e) => e.kind === 'node' && e.typeId === 'stoneDeposit'),
          farm: near((e) => e.kind === 'building' && e.typeId === 'farm') };
        const plan = [['wood', 0, 1, 2], ['food', 3, 4], ['gold', 5, 6], ['stone', 7, 8], ['farm', 9]];
        for (const [k, ...idx] of plan) if (t[k]) window.__art.issue({ type: 'gather', unitIds: idx.map((i) => v[i]), nodeId: t[k].id, queue: false });
        window.__art.issue({ type: 'build', unitIds: [v[10], v[11]], buildingType: 'house', tx: Math.round(vs.x) - 6, ty: Math.round(vs.y) + 6, queue: false });
        g.cheat.instantBuild(false);
        for (let i = 0; i < 40; i++) g.step(10, false);
        g.step(1);
      }, { ids, x: tc.x, y: tc.y });
      for (const z of [1, 2]) {
        await lookAt(tc.x - 2, tc.y + 3, z);
        await shot(`jobs-${z}x`);
      }
    }
    if (want('forest')) {
      const spot = await page.evaluate((c) => {
        const s = window.__game.state;
        const trees = s.entities.filter((e) => e.kind === 'node' && e.typeId === 'tree');
        trees.sort((a, b) => Math.hypot(a.tile.tx - c.x, a.tile.ty - c.y) - Math.hypot(b.tile.tx - c.x, b.tile.ty - c.y));
        return { x: trees[0].tile.tx + 0.5, y: trees[0].tile.ty + 0.5 };
      }, tc);
      const ids = await spawn(Array.from({ length: 6 }, (_, i) => ['villager', spot.x - 2 + i * 0.4, spot.y + 2]));
      await page.evaluate(([v, sp]) => {
        const g = window.__game;
        const trees = g.state.entities.filter((e) => e.kind === 'node' && e.typeId === 'tree');
        trees.sort((a, b) => Math.hypot(a.tile.tx - sp.x, a.tile.ty - sp.y) - Math.hypot(b.tile.tx - sp.x, b.tile.ty - sp.y));
        v.forEach((id, i) => window.__art.issue({ type: 'gather', unitIds: [id], nodeId: trees[i % 4].id, queue: false }));
        for (let i = 0; i < 30; i++) g.step(10, false);
        g.step(1);
      }, [ids, spot]);
      for (const z of [1, 2]) {
        await lookAt(spot.x, spot.y, z);
        await shot(`forest-${z}x`);
      }
    }
    if (want('anims')) {
      const states = ['attack', 'death', 'corpse'];
      const items = [];
      const at = (await openStrip(16, 6)) ?? { x: tc.x + 10, y: tc.y + 6 };
      UNITS.forEach((u, i) => states.forEach((st, k) => items.push([u, at.x + i * 1.5 + k * 2.0, at.y - i * 1.5 + k * 2.0])));
      const ids = await spawn(items);
      await turn(ids, 0, 0.6);
      await page.evaluate(([list, sts]) => list.forEach((id, k) => window.__art.preview(id, sts[k % 3])), [ids, states]);
      await page.evaluate(() => window.__game.step(1));
      await lookAt(at.x + 7.5, at.y - 5.5, 1);
      // Previews run on game time like every animation: step past the 7-frame death so it shows the body down.
      await page.evaluate(() => window.__game.step(16));
      await shot('anims');
    }
    if (want('scale')) {
      const ids = await spawn(UNITS.map((u, i) => [u, tc.x - 4 + (i % 5) * 1.6, tc.y - 4.5 + Math.floor(i / 5) * 1.8]));
      void ids;
      await lookAt(tc.x - 1, tc.y - 2, 2);
      await shot('scale-2x');
    }
  }
  if (want('battle')) {
    // WP27 effects in a real fight (two players, the opponent's AI off): arrows and stones in flight, melee hits, death
    // animations and corpses, burning buildings and rubble, at 0.5x, 1x and 2x.
    await start('&opponent=standard&ai=off');
    await page.waitForFunction(() => window.__art?.report()?.complete === true, null, { timeout: 300_000 });
    const placed = await placeTown(['house', 'house', 'barracks', 'house', 'mill']);
    console.log('placed', placed.join(','));
    const field = await page.evaluate(() => {
      const s = window.__game.state;
      const tc = s.entities.find((e) => e.kind === 'building' && e.typeId === 'townCenter' && e.owner === 1);
      const c = { x: tc.tile.tx + 2, y: tc.tile.ty + 2 };
      const blocked = (x, y, r) => s.entities.some((e) => e.kind !== 'unit' && Math.hypot(e.tile.tx + 0.5 - x, e.tile.ty + 0.5 - y) < r);
      for (let dist = 12; dist < 45; dist++)
        for (let a = 0; a < 48; a++) {
          const x = c.x + Math.cos((a / 48) * Math.PI * 2) * dist;
          const y = c.y + Math.sin((a / 48) * Math.PI * 2) * dist;
          if (x < 16 || y < 16 || x > s.map.width - 16 || y > s.map.height - 16) continue;
          let ok = true;
          for (let i = -4; i <= 4 && ok; i++) for (let j = -4; j <= 4 && ok; j++) ok = !blocked(x + i, y + j, 1.6);
          if (ok) return { x, y };
        }
      return { x: c.x + 12, y: c.y };
    });
    // Blue in the north-west half of the field, red in the south-east, about 7 tiles apart.
    const army = await page.evaluate((f) => {
      const g = window.__game;
      const before = new Set(g.state.entities.map((e) => e.id));
      const blue = [
        ['spearman', -1.5, -3], ['spearman', -0.3, -3.4], ['swordsman', 0.9, -3.8], ['swordsman', -2.6, -2.5],
        ['archer', -2.2, -4.6], ['archer', -1, -5], ['archer', 0.2, -5.4], ['horseman', 2, -4.4], ['siphonarios', -3.4, -3.6],
        ['trebuchet', -3, -7], ['batteringRam', 1.6, -6.4],
      ];
      const red = [
        ['spearman', -1.5, 3], ['swordsman', -0.3, 3.4], ['swordsman', 0.9, 3.8], ['spearman', -2.6, 2.5],
        ['archer', -2.2, 4.6], ['archer', -1, 5], ['archer', 0.2, 5.4], ['cataphract', 2, 4.4], ['horseman', -3.4, 3.6], ['lancer', 2.8, 3.2],
      ];
      for (const [t, dx, dy] of blue) g.cheat.spawnUnit(t, f.x + dx * 0.7 + dy * 0.7, f.y - dx * 0.7 + dy * 0.7, 1);
      for (const [t, dx, dy] of red) g.cheat.spawnUnit(t, f.x + dx * 0.7 + dy * 0.7, f.y - dx * 0.7 + dy * 0.7, 2);
      g.step(1);
      const ids = g.state.entities.filter((e) => !before.has(e.id) && e.kind === 'unit');
      return { blue: ids.filter((e) => e.owner === 1).map((e) => e.id), red: ids.filter((e) => e.owner === 2).map((e) => e.id) };
    }, field);
    await page.evaluate(([f, ids]) => {
      const g = window.__game;
      window.__art.issue({ type: 'attackMove', unitIds: ids, x: f.x + 3, y: f.y + 3, queue: false });
      g.step(1);
    }, [field, army.blue]);
    // Damage the town: a House at 50% (one fire), the Barracks at 25% (large fires), another House destroyed (rubble).
    await page.evaluate(() => {
      const g = window.__game;
      const mine = g.state.entities.filter((e) => e.kind === 'building' && e.owner === 1);
      const houses = mine.filter((e) => e.typeId === 'house');
      const barracks = mine.find((e) => e.typeId === 'barracks');
      if (houses[0]) g.cheat.setHp(houses[0].id, Math.round(houses[0].hp * 0.5));
      if (barracks) g.cheat.setHp(barracks.id, Math.round(barracks.hp * 0.25));
      if (houses[1]) g.cheat.setHp(houses[1].id, 0);
      g.step(1);
    });
    // Into the clash: step until arrows fly and the first units have fallen.
    await page.evaluate(() => {
      const g = window.__game;
      for (let i = 0; i < 400; i++) {
        g.step(1, false);
        if (g.effects().corpses >= 3 && g.state.projectiles.length >= 2) break;
      }
      g.step(1);
    });
    console.log('battle effects', JSON.stringify(await page.evaluate(() => window.__game.effects())));
    for (const z of [1, 0.5, 2]) {
      await lookAt(field.x, field.y, z);
      if (z === 1) {
        // Box-select our army so the HUD shows its portraits and health bars show over the selection.
        const box = await page.evaluate((ids) => {
          const g = window.__game;
          const pts = g.state.entities.filter((e) => ids.includes(e.id)).map((e) => g.worldToScreen(e.pos.x, e.pos.y));
          const xs = pts.map((p) => p.x);
          const ys = pts.map((p) => p.y);
          return { x0: Math.min(...xs) - 20, y0: Math.min(...ys) - 40, x1: Math.max(...xs) + 20, y1: Math.min(Math.max(...ys) + 10, window.innerHeight - 200) };
        }, army.blue);
        await page.evaluate(() => window.__game.advanceClock(1000));
        await page.mouse.move(box.x0, box.y0);
        await page.mouse.down();
        await page.mouse.move((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, { steps: 4 });
        await page.mouse.move(box.x1, box.y1, { steps: 4 });
        await page.mouse.up();
        await page.mouse.move(640, 70);
        await page.evaluate(() => window.__game.step(0));
      }
      await shot(`battle-${z}x`);
    }
    // The town: burning buildings and the rubble.
    const town = await tcTile();
    await lookAt(town.x + 2, town.y + 2, 1);
    await shot('battle-town');
    // Later: the field after the fight (corpses), then the rubble close up.
    await page.evaluate(() => {
      const g = window.__game;
      for (let i = 0; i < 30; i++) g.step(10, false);
      g.step(1);
    });
    console.log('aftermath effects', JSON.stringify(await page.evaluate(() => window.__game.effects())));
    await lookAt(field.x, field.y, 1.5);
    await shot('battle-aftermath');
  }
  if (want('cache')) {
    // Wait for the background pass (it writes the cache), then load again: the art should come from IndexedDB.
    await page.waitForFunction(() => window.__art?.report()?.complete === true, null, { timeout: 300_000 });
    console.log('full set', JSON.stringify(await page.evaluate(() => window.__art.report())));
    await page.waitForTimeout(1500); // let the IndexedDB write finish (tooling only, not a test)
    const t1 = Date.now();
    await start();
    console.log('second boot ms', Date.now() - t1, JSON.stringify(await page.evaluate(() => window.__art.report())));
  }
  console.log('total ms', Date.now() - t0);
  await browser.close();
} catch (e) {
  process.exitCode = 1;
  throw e;
} finally {
  server.kill();
  console.log(errors.length ? `console errors:\n${errors.join('\n')}` : 'no console errors');
}
