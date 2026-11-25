import { expect, test, type Page } from '@playwright/test';

/** Phase 1 scenarios (plan 9.3 scenarios 1, 2 and the camera half of 11). Screenshots go to the git-ignored test-results/screenshots/phase1/. */
const SHOTS = 'test-results/screenshots/phase1';

interface Pt {
  x: number;
  y: number;
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

async function startMatch(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('main-menu')).toBeVisible();
  await page.getByTestId('new-game').click();
  await expect(page.locator('canvas.world-canvas')).toBeVisible({ timeout: 5_000 });
  await expect.poll(() => page.evaluate(() => window.__game?.state?.entities.length ?? 0)).toBeGreaterThan(10);
  // Let the first frames render.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/** Own villagers (id, world position) from the live state. */
function villagers(page: Page): Promise<{ id: number; x: number; y: number }[]> {
  return page.evaluate(() =>
    (window.__game?.state?.entities ?? [])
      .filter((e) => e.kind === 'unit' && e.owner === 1 && e.typeId === 'villager')
      .map((e) => (e.kind === 'unit' ? { id: e.id, x: e.pos.x, y: e.pos.y } : { id: e.id, x: 0, y: 0 })),
  );
}

function toScreen(page: Page, x: number, y: number): Promise<Pt> {
  return page.evaluate(([wx, wy]) => window.__game!.worldToScreen(wx!, wy!), [x, y] as const);
}

function selection(page: Page): Promise<number[]> {
  return page.evaluate(() => [...(window.__game?.selection ?? [])]);
}

async function townCenter(page: Page): Promise<{ id: number; cx: number; cy: number }> {
  return page.evaluate(() => {
    const tc = window.__game!.state!.entities.find((e) => e.kind === 'building' && e.owner === 1 && e.typeId === 'townCenter');
    if (tc === undefined || tc.kind !== 'building') throw new Error('no town center');
    return { id: tc.id, cx: tc.tile.tx + 2, cy: tc.tile.ty + 2 };
  });
}

/** A visible screen point with no entity within 3 tiles (so clicking it hits open ground). */
function clearGround(page: Page): Promise<Pt> {
  return page.evaluate(() => {
    const g = window.__game!;
    const ents = g.state!.entities;
    const tc = ents.find((e) => e.kind === 'building' && e.owner === 1)!;
    const cx = tc.kind === 'building' ? tc.tile.tx + 2 : 0;
    const cy = tc.kind === 'building' ? tc.tile.ty + 2 : 0;
    for (const [dx, dy] of [[6, 7], [7, -6], [-7, 6], [-6, -7], [9, 3], [3, 9], [-9, -3], [-3, -9], [8, 8], [-8, -8], [8, -8], [-8, 8], [11, 0], [0, 11], [-11, 0], [0, -11], [10, 6], [6, 10], [-10, -6], [-6, -10], [10, -6], [-6, 10], [6, -10], [-10, 6]]) {
      const x = cx + dx!;
      const y = cy + dy!;
      const s = g.worldToScreen(x, y);
      if (s.x < 80 || s.x > 1200 || s.y < 80 || s.y > 640) continue;
      const clear = ents.every((e) => {
        const ex = e.kind === 'unit' ? e.pos.x : e.tile.tx + 1;
        const ey = e.kind === 'unit' ? e.pos.y : e.tile.ty + 1;
        return Math.hypot(ex - x, ey - y) > 4;
      });
      if (clear) return s;
    }
    throw new Error('no clear ground on screen');
  });
}

test('scenario 1: boot, menu, match renders with grass, a Town Center and 6 villagers', async ({ page }) => {
  const errors = collectErrors(page);
  const t0 = Date.now();
  await startMatch(page);
  expect(Date.now() - t0).toBeLessThan(5_000);

  const summary = await page.evaluate(() => {
    const s = window.__game!.state!;
    const mine = s.entities.filter((e) => e.owner === 1);
    return {
      screen: window.__game!.screen,
      tcs: mine.filter((e) => e.typeId === 'townCenter').length,
      villagers: mine.filter((e) => e.typeId === 'villager').length,
      nodes: s.entities.filter((e) => e.kind === 'node').length,
    };
  });
  expect(summary).toMatchObject({ screen: 'game', tcs: 1, villagers: 6 });
  expect(summary.nodes).toBeGreaterThan(50);

  // The camera starts on the Town Center.
  const tc = await townCenter(page);
  const p = await toScreen(page, tc.cx, tc.cy);
  expect(Math.abs(p.x - 640)).toBeLessThan(3);
  expect(Math.abs(p.y - 360)).toBeLessThan(3);

  await page.screenshot({ path: `${SHOTS}/01-match-start.png` });
  expect(errors).toEqual([]);
});

test('scenario 2: box-select villagers on the canvas, right-click ground, they arrive', async ({ page }) => {
  const errors = collectErrors(page);
  await startMatch(page);
  await page.evaluate(() => window.__game!.setPaused(true));

  const vs = await villagers(page);
  expect(vs).toHaveLength(6);
  const pts = await Promise.all(vs.map((v) => toScreen(page, v.x, v.y)));
  const minX = Math.min(...pts.map((p) => p.x)) - 25;
  const maxX = Math.max(...pts.map((p) => p.x)) + 25;
  const minY = Math.min(...pts.map((p) => p.y)) - 40;
  const maxY = Math.max(...pts.map((p) => p.y)) + 15;

  // Drag a box around everyone; screenshot while dragging.
  await page.mouse.move(minX, minY);
  await page.mouse.down();
  await page.mouse.move((minX + maxX) / 2, (minY + maxY) / 2, { steps: 4 });
  await page.mouse.move(maxX, maxY, { steps: 4 });
  await page.screenshot({ path: `${SHOTS}/02-drag-box.png` });
  await page.mouse.up();
  expect(await selection(page)).toEqual(vs.map((v) => v.id).sort((a, b) => a - b));
  await page.screenshot({ path: `${SHOTS}/03-villagers-selected.png` });

  // Right-click open ground a few tiles away (no entity within 3 tiles, on screen).
  const tc = await townCenter(page);
  const target = await page.evaluate(
    ([cx, cy]) => {
      const g = window.__game!;
      const ents = g.state!.entities;
      const candidates = [[6, 7], [7, -6], [-7, 6], [-6, -7], [9, 3], [3, 9], [-9, -3], [-3, -9]];
      for (const [dx, dy] of candidates) {
        const x = cx! + dx!;
        const y = cy! + dy!;
        const s = g.worldToScreen(x, y);
        if (s.x < 80 || s.x > 1200 || s.y < 80 || s.y > 640) continue;
        const clear = ents.every((e) => {
          const ex = e.kind === 'unit' ? e.pos.x : e.tile.tx + 1;
          const ey = e.kind === 'unit' ? e.pos.y : e.tile.ty + 1;
          return Math.hypot(ex - x, ey - y) > (e.kind === 'building' ? 5 : 3);
        });
        if (clear) return { x, y, sx: s.x, sy: s.y };
      }
      return null;
    },
    [tc.cx, tc.cy] as const,
  );
  expect(target).not.toBeNull();
  await page.mouse.click(target!.sx, target!.sy, { button: 'right' });

  // Commands apply at the start of the next tick; a short run makes them visibly walk.
  await page.evaluate(() => window.__game!.step(30));
  await page.screenshot({ path: `${SHOTS}/04-walking.png` });
  const midway = await villagers(page);
  const moved = midway.filter((v, i) => Math.hypot(v.x - vs[i]!.x, v.y - vs[i]!.y) > 0.5);
  expect(moved.length).toBeGreaterThanOrEqual(5);

  await page.evaluate(() => window.__game!.step(400));
  const arrived = await villagers(page);
  for (const v of arrived) expect(Math.hypot(v.x - target!.x, v.y - target!.y), `villager ${v.id}`).toBeLessThan(3.5);
  await page.screenshot({ path: `${SHOTS}/05-arrived.png` });
  expect(await selection(page)).toHaveLength(6);
  expect(errors).toEqual([]);
});

test('selection: click, shift, double-click, groups, H, idle cycle, delete and pruning', async ({ page }) => {
  const errors = collectErrors(page);
  await startMatch(page);
  await page.evaluate(() => window.__game!.setPaused(true));
  const vs = await villagers(page);
  const ids = vs.map((v) => v.id).sort((a, b) => a - b);

  // Click the front-most villager (largest x + y): nothing can cover it.
  const front = [...vs].sort((a, b) => b.x + b.y - (a.x + a.y))[0]!;
  const fp = await toScreen(page, front.x, front.y);
  const ground = await clearGround(page);
  await page.mouse.click(fp.x, fp.y - 14);
  expect(await selection(page)).toEqual([front.id]);

  // Shift-click toggles it off again.
  await page.keyboard.down('Shift');
  await page.mouse.click(fp.x, fp.y - 14);
  await page.keyboard.up('Shift');
  expect(await selection(page)).toEqual([]);

  // Double-click selects every visible villager.
  await page.mouse.dblclick(fp.x, fp.y - 14);
  expect(await selection(page)).toEqual(ids);

  // Click empty ground clears.
  await page.mouse.click(ground.x, ground.y);
  expect(await selection(page)).toEqual([]);

  // Control groups: Ctrl+1 assigns, 1 recalls.
  await page.mouse.dblclick(fp.x, fp.y - 14);
  await page.keyboard.press('Control+Digit1');
  await page.mouse.click(ground.x, ground.y);
  expect(await selection(page)).toEqual([]);
  await page.keyboard.press('Digit1');
  expect(await selection(page)).toEqual(ids);

  // H selects and centres the Town Center.
  const tc = await townCenter(page);
  await page.keyboard.press('KeyH');
  expect(await selection(page)).toEqual([tc.id]);
  const c = await toScreen(page, tc.cx, tc.cy);
  expect(Math.abs(c.x - 640)).toBeLessThan(3);

  // '.' cycles idle villagers.
  await page.keyboard.press('Period');
  const first = await selection(page);
  expect(first).toHaveLength(1);
  expect(ids).toContain(first[0]);
  await page.keyboard.press('Period');
  const second = await selection(page);
  expect(second[0]).not.toBe(first[0]);

  // Delete removes the selected villager; selection is pruned.
  await page.keyboard.press('Delete');
  await page.evaluate(() => window.__game!.step(3));
  expect(await selection(page)).toEqual([]);
  expect((await villagers(page)).map((v) => v.id)).not.toContain(second[0]);
  await page.screenshot({ path: `${SHOTS}/06-after-delete.png` });
  expect(errors).toEqual([]);
});

test('scenario 11 (camera): pan, zoom and clamp; WASD no longer pans', async ({ page }) => {
  const errors = collectErrors(page);
  await startMatch(page);
  const tc = await townCenter(page);
  const at = (): Promise<Pt> => toScreen(page, tc.cx, tc.cy);

  // WASD are command-card keys now: they must not move the camera.
  const start = await at();
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(400);
  await page.keyboard.up('KeyD');
  const afterD = await at();
  expect(Math.abs(afterD.x - start.x)).toBeLessThan(1);

  // Arrow keys pan: holding Right moves the view right, so the TC moves left on screen.
  await page.mouse.move(640, 360);
  await page.keyboard.down('ArrowRight');
  await expect.poll(async () => (await at()).x).toBeLessThan(start.x - 100);
  await page.keyboard.up('ArrowRight');
  await page.waitForTimeout(100);
  const panned = await at();

  // Middle-drag pans too.
  await page.mouse.move(600, 300);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(700, 340, { steps: 5 });
  await page.mouse.up({ button: 'middle' });
  const dragged = await at();
  expect(dragged.x - panned.x).toBeCloseTo(100, 0);
  expect(dragged.y - panned.y).toBeCloseTo(40, 0);

  // Wheel zoom about the cursor, clamped to 0.5x - 2x.
  const zoomOf = async (): Promise<number> => {
    const a = await toScreen(page, 50, 50);
    const b = await toScreen(page, 60, 50);
    return (b.x - a.x) / 320;
  };
  expect(await zoomOf()).toBeCloseTo(1, 2);
  await page.mouse.move(640, 360);
  await page.mouse.wheel(0, -300);
  await expect.poll(zoomOf).toBeGreaterThan(1.2);
  await page.screenshot({ path: `${SHOTS}/07-zoom-in.png` });
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -500);
  await expect.poll(zoomOf).toBeCloseTo(2, 2);
  for (let i = 0; i < 14; i++) await page.mouse.wheel(0, 500);
  await expect.poll(zoomOf).toBeCloseTo(0.5, 2);
  await page.screenshot({ path: `${SHOTS}/08-zoom-out.png` });

  // Clamp: scroll right until the view stops; the map's right corner then sits 96 px (x zoom) inside the right edge.
  await page.keyboard.down('ArrowRight');
  const corner = (): Promise<Pt> => toScreen(page, 120, 0);
  let last = (await corner()).x;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(250);
    const now = (await corner()).x;
    if (Math.abs(now - last) < 0.01) break;
    last = now;
  }
  await page.keyboard.up('ArrowRight');
  const edge = (await corner()).x;
  expect(Math.abs(edge - (1280 - 96 * 0.5))).toBeLessThan(2);
  await page.screenshot({ path: `${SHOTS}/09-clamped-right.png` });
  expect(errors).toEqual([]);
});
