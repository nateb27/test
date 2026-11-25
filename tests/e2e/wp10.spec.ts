import { expect, test, type Page } from '@playwright/test';
import {
  collectErrors,
  frames as frame,
  openGround,
  inputMode,
  overlayStats as stats,
  selectAllVillagers,
  selection,
  shot,
  slot,
  startMatch as start,
  step,
  toMinimap,
  toScreen,
  townCenter as tcEntry,
  type Pt,
} from './helpers';

/** WP10: minimap, overlays and placement ghost, now through the real HUD. Screenshots go to the git-ignored test-results/screenshots/. */

const startMatch = (page: Page): Promise<void> => start(page, { paused: true });
const townCenter = async (page: Page): Promise<{ id: number; cx: number; cy: number }> => {
  const t = await tcEntry(page);
  return { id: t.id, cx: t.x, cy: t.y };
};

/** With villagers selected: Economy page, then the House button. */
async function startHousePlacement(page: Page): Promise<void> {
  await slot(page, 0).click();
  await slot(page, 0).click();
  expect(await inputMode(page)).toBe('placement');
}

/** Camera centre in world tiles (what is under the middle of the canvas). */
const cameraWorld = (page: Page): Promise<Pt> =>
  page.evaluate(() => {
    const g = window.__game!;
    // Invert worldToScreen at the canvas centre with the iso formulas (screen = ((x - y) * 32, (x + y) * 16) + offset).
    const o = g.worldToScreen(0, 0);
    const sx = (640 - o.x) / 1;
    const sy = (360 - o.y) / 1;
    return { x: (sx / 32 + sy / 16) / 2, y: (sy / 16 - sx / 32) / 2 };
  });

/** Pixels of the visible minimap base canvas around a page point. */
function minimapPixels(page: Page, px: number, py: number, radius = 0): Promise<{ r: number; g: number; b: number; a: number }[]> {
  return page.evaluate(
    ([x, y, rad]) => {
      const c = document.querySelector<HTMLCanvasElement>('[data-testid="minimap-base"]')!;
      const r = c.getBoundingClientRect();
      const sx = c.width / r.width;
      const ctx = c.getContext('2d')!;
      const cx = Math.round((x! - r.left) * sx);
      const cy = Math.round((y! - r.top) * sx);
      const out: { r: number; g: number; b: number; a: number }[] = [];
      for (let j = -rad!; j <= rad!; j++) {
        for (let i = -rad!; i <= rad!; i++) {
          const d = ctx.getImageData(cx + i, cy + j, 1, 1).data;
          out.push({ r: d[0]!, g: d[1]!, b: d[2]!, a: d[3]! });
        }
      }
      return out;
    },
    [px, py, radius] as const,
  );
}

const near = (c: { r: number; g: number; b: number }, hex: number, tol = 14): boolean =>
  Math.abs(c.r - ((hex >> 16) & 255)) <= tol && Math.abs(c.g - ((hex >> 8) & 255)) <= tol && Math.abs(c.b - (hex & 255)) <= tol;

/**
 * A point on the map (on screen or not) with no building or node nearby, preferring the widest margin: picking
 * uses tall sprite hit boxes, so a right click close to a deposit or tree would resolve to that entity.
 */
function farOpenGround(page: Page): Promise<Pt> {
  return page.evaluate(() => {
    const ents = window.__game!.state!.entities;
    for (const margin of [12, 10, 8, 6]) {
      for (let r = 8; r <= 50; r += 2) {
        for (let a = 0; a < 24; a++) {
          const x = Math.round(60 + Math.cos((a * Math.PI) / 12) * r);
          const y = Math.round(60 + Math.sin((a * Math.PI) / 12) * r);
          if (x < 8 || y < 8 || x > 111 || y > 111) continue;
          if (ents.every((e) => e.kind === 'unit' || Math.hypot(e.tile.tx + 0.5 - x, e.tile.ty + 0.5 - y) > margin)) return { x, y };
        }
      }
    }
    throw new Error('no open ground');
  });
}

test('minimap: left click and drag move the camera; right click orders units there', async ({ page }) => {
  const errors = collectErrors(page);
  await startMatch(page);
  await shot(page, 'wp10-01-match-with-minimap');

  // Click a world point well inside the map: the camera centres on it.
  const target = { x: 40, y: 70 };
  const m = await toMinimap(page, target.x, target.y);
  await page.mouse.click(m.x, m.y);
  await frame(page);
  const c = await cameraWorld(page);
  expect(Math.abs(c.x - target.x)).toBeLessThan(1.5);
  expect(Math.abs(c.y - target.y)).toBeLessThan(1.5);
  await shot(page, 'wp10-02-minimap-click');

  // Dragging follows the pointer.
  const a = await toMinimap(page, 80, 30);
  const b = await toMinimap(page, 30, 40);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 3 });
  await page.mouse.move(b.x, b.y, { steps: 3 });
  await frame(page);
  const mid = await cameraWorld(page);
  expect(Math.abs(mid.x - 30)).toBeLessThan(1.5);
  expect(Math.abs(mid.y - 40)).toBeLessThan(1.5);
  await page.mouse.up();
  // Releasing stops following.
  await page.mouse.move(a.x, a.y);
  await frame(page);
  expect(Math.abs((await cameraWorld(page)).x - 30)).toBeLessThan(1.5);

  // Back to the Town Center, select the villagers, right click the minimap: they are ordered to move there.
  await page.keyboard.press('KeyH');
  await selectAllVillagers(page);
  const dest = await farOpenGround(page); // the seed is random: a tree or deposit under the click would turn the order into a gather
  const d = await toMinimap(page, dest.x, dest.y);
  await page.mouse.click(d.x, d.y, { button: 'right' });
  await step(page, 2);
  const orders = await page.evaluate(() =>
    window.__game!.state!.entities
      .filter((e) => e.kind === 'unit' && e.owner === 1 && e.typeId === 'villager')
      .map((e) => (e.kind === 'unit' ? e.currentOrder : null)),
  );
  expect(orders.length).toBeGreaterThan(0);
  for (const o of orders) {
    expect(o).toMatchObject({ type: 'move' });
    expect(Math.abs((o as { x: number }).x - dest.x), JSON.stringify({ orders, dest })).toBeLessThan(3);
    expect(Math.abs((o as { y: number }).y - dest.y)).toBeLessThan(3);
  }
  expect(errors).toEqual([]);
});

test('minimap shows the Town Center, resource nodes, units and the camera outline', async ({ page }) => {
  const errors = collectErrors(page);
  await startMatch(page);
  await page.waitForTimeout(450); // the dynamic layer redraws at 5 Hz

  const info = await page.evaluate(() => {
    const s = window.__game!.state!;
    const tc = s.entities.find((e) => e.kind === 'building' && e.owner === 1)!;
    // A node of each kind that no later-drawn mark (higher-id node, any building) overlaps.
    // (a wider margin first: the less other marks nearby, the less a sample can be covered)
    const pick = (typeId: string) => {
      for (const margin of [6, 5, 3.5]) {
        const found = s.entities.find(
          (e) =>
            e.kind === 'node' &&
            e.typeId === typeId &&
            s.entities.every((o) => o === e || o.kind === 'unit' || Math.hypot(o.tile.tx - e.tile.tx, o.tile.ty - e.tile.ty) > margin || (o.kind === 'node' && o.id < e.id)),
        );
        if (found !== undefined) return found;
      }
      // Crowded map: the last-drawn one of its kind (nothing of the same cluster is drawn after it).
      return s.entities.filter((e) => e.kind === 'node' && e.typeId === typeId).at(-1)!;
    };
    const gold = pick('goldDeposit');
    const stone = pick('stoneDeposit');
    const berry = pick('berryBush');
    const at = (e: typeof tc, size: number) => (e.kind === 'unit' ? { x: 0, y: 0 } : { x: e.tile.tx + size / 2, y: e.tile.ty + size / 2 });
    return {
      color: s.players[1]!.color,
      tc: at(tc, 4),
      gold: at(gold, 2),
      stone: at(stone, 2),
      berry: at(berry, 1),
      trees: s.entities.filter((e) => e.kind === 'node' && e.typeId === 'tree').length,
    };
  });
  const colors = { gold: 0xe0b020, stone: 0x8a8d93, berry: 0xb03a5b, tree: 0x2d5a1e };

  const tcp = await toMinimap(page, info.tc.x, info.tc.y);
  expect((await minimapPixels(page, tcp.x, tcp.y, 4)).some((c) => near(c, info.color))).toBe(true);
  for (const k of ['gold', 'stone', 'berry'] as const) {
    const p = await toMinimap(page, info[k].x, info[k].y);
    expect((await minimapPixels(page, p.x, p.y, 3)).some((c) => near(c, colors[k])), `${k} mark`).toBe(true);
  }
  // Many tree pixels across the map.
  expect(info.trees).toBeGreaterThan(100);
  const trees = await page.evaluate(
    ([hex]) => {
      const c = document.querySelector<HTMLCanvasElement>('[data-testid="minimap-base"]')!;
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (Math.abs(d[i]! - ((hex! >> 16) & 255)) < 6 && Math.abs(d[i + 1]! - ((hex! >> 8) & 255)) < 6 && Math.abs(d[i + 2]! - (hex! & 255)) < 6) n++;
      }
      return n;
    },
    [colors.tree] as const,
  );
  expect(trees).toBeGreaterThan(60);

  // Units: own villagers draw in the owner colour on the base canvas.
  const villager = await page.evaluate(() => {
    const v = window.__game!.state!.entities.find((e) => e.kind === 'unit' && e.owner === 1)!;
    return v.kind === 'unit' ? { x: v.pos.x, y: v.pos.y } : { x: 0, y: 0 };
  });
  const vp = await toMinimap(page, villager.x, villager.y);
  const vpix = await minimapPixels(page, vp.x, vp.y, 3);
  expect(vpix.some((c) => near(c, info.color)), JSON.stringify({ vp, villager, color: info.color, vpix })).toBe(true);

  // The camera outline (white) is on the top canvas.
  const outline = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('[data-testid="minimap-canvas"]')!;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let white = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i]! > 200 && d[i + 1]! > 200 && d[i + 2]! > 200 && d[i + 3]! > 100) white++;
    return white;
  });
  expect(outline).toBeGreaterThan(8); // the outline is clipped to the map diamond, so near a map corner only part of it shows

  const box = await page.locator('[data-testid="minimap"]').boundingBox();
  await page.screenshot({ path: `test-results/screenshots/wp10-03-minimap.png`, clip: { x: box!.x - 8, y: box!.y - 8, width: box!.width + 16, height: box!.height + 16 } });
  await shot(page, 'wp10-04-minimap-full-view');
  expect(errors).toEqual([]);
});

test('selection rings, drag box, bars, carried marker, rally flag and order markers', async ({ page }) => {
  const errors = collectErrors(page);
  await startMatch(page);
  expect((await stats(page)).rings).toBe(0);

  const ids = await selectAllVillagers(page);
  await frame(page);
  expect((await stats(page)).rings).toBe(ids.length);
  await shot(page, 'wp10-05-selection-rings');

  // Drag box overlay is visible while dragging (screenshot only; selection logic is WP5's).
  await page.mouse.move(300, 150);
  await page.mouse.down();
  await page.mouse.move(520, 280, { steps: 4 });
  await frame(page);
  await shot(page, 'wp10-06-drag-box');
  await page.mouse.up();

  // Order marker: right click open ground with villagers selected.
  await selectAllVillagers(page);
  const tc = await townCenter(page);
  const ground = await openGround(page, tc.cx, tc.cy + 5, 3);
  const addedBefore = (await stats(page)).markersAdded!;
  await page.mouse.click(ground.sx, ground.sy, { button: 'right' });
  await frame(page);
  expect((await stats(page)).markersAdded).toBe(addedBefore + 1);
  await shot(page, 'wp10-07-move-marker');
  // The marker is brief: it disappears by itself.
  await expect.poll(async () => {
    await frame(page);
    return (await stats(page)).markers;
  }, { timeout: 5000 }).toBe(0);

  // Carried marker: send the villagers to the nearest tree and let them work for a while.
  const tree = await page.evaluate(
    ([cx, cy]) => {
      const g = window.__game!;
      let best: { x: number; y: number } | null = null;
      let bestD = Infinity;
      for (const e of g.state!.entities) {
        if (e.kind !== 'node' || e.typeId !== 'tree') continue;
        const x = e.tile.tx + 0.5;
        const y = e.tile.ty + 0.5;
        const s = g.worldToScreen(x, y);
        if (s.x < 100 || s.x > 1180 || s.y < 120 || s.y > 480) continue;
        const d = Math.hypot(x - cx!, y - cy!);
        if (d < bestD) {
          bestD = d;
          best = { x, y };
        }
      }
      return best;
    },
    [tc.cx, tc.cy] as const,
  );
  expect(tree).not.toBeNull();
  const tp = await toScreen(page, tree!.x, tree!.y);
  await page.mouse.click(tp.x, tp.y, { button: 'right' });
  await step(page, 500);
  await frame(page);
  expect((await stats(page)).carry).toBeGreaterThanOrEqual(1);

  // Queue bar and rally flag: select the Town Center, train a villager with the card, set the rally with the card.
  await page.keyboard.press('KeyH');
  await slot(page, 0).click();
  await step(page, 60);
  await page.keyboard.press('KeyB');
  const rally = await openGround(page, tc.cx, tc.cy + 4, 3);
  await page.mouse.click(rally.sx, rally.sy);
  expect(await inputMode(page)).toBeNull();
  await step(page, 2);
  await frame(page);
  const st = await stats(page);
  expect(st.bars).toBe(1);
  expect(st.flags).toBe(1);
  expect(st.outlines).toBe(1);
  await shot(page, 'wp10-08-rally-bars');
  expect(errors).toEqual([]);
});

/** A 2x2-free grass spot, a tree and the Town Center, all visible on screen. */
async function probeSpots(page: Page): Promise<{ grass: Pt; tree: Pt; tc: Pt }> {
  return page.evaluate(() => {
    const g = window.__game!;
    const ents = g.state!.entities;
    const tcE = ents.find((e) => e.kind === 'building' && e.owner === 1)!;
    const tc = tcE.kind === 'building' ? { x: tcE.tile.tx + 2, y: tcE.tile.ty + 2 } : { x: 0, y: 0 };
    const onScreen = (x: number, y: number): boolean => {
      const s = g.worldToScreen(x, y);
      return s.x > 150 && s.x < 1130 && s.y > 120 && s.y < 560;
    };
    // Occupied tiles (buildings and nodes; footprints by type).
    const sizes: Record<string, number> = { townCenter: 4, goldDeposit: 2, stoneDeposit: 2 };
    const occupied = new Set<string>();
    for (const e of ents) {
      if (e.kind === 'unit') continue;
      const n = sizes[e.typeId] ?? 1;
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) occupied.add(`${e.tile.tx + i},${e.tile.ty + j}`);
    }
    let grass: { x: number; y: number } | null = null;
    for (let r = 5; r <= 16 && grass === null; r++) {
      for (let dx = -r; dx <= r && grass === null; dx++) {
        for (const dy of [-r, r]) {
          const x = Math.round(tc.x + dx);
          const y = Math.round(tc.y + dy);
          if (!onScreen(x, y)) continue;
          let free = true;
          for (let j = -2; j <= 1; j++) for (let i = -2; i <= 1; i++) if (occupied.has(`${x + i},${y + j}`)) free = false;
          if (free) {
            grass = { x, y };
            break;
          }
        }
      }
    }
    let tree: { x: number; y: number } | null = null;
    let best = Infinity;
    for (const e of ents) {
      if (e.kind !== 'node' || e.typeId !== 'tree' || !onScreen(e.tile.tx + 0.5, e.tile.ty + 0.5)) continue;
      const d = Math.hypot(e.tile.tx - tc.x, e.tile.ty - tc.y);
      if (d < best) {
        best = d;
        tree = { x: e.tile.tx + 0.5, y: e.tile.ty + 0.5 };
      }
    }
    if (grass === null) throw new Error('no open grass spot on screen');
    if (tree === null) throw new Error('no tree on screen');
    return { grass, tree, tc };
  });
}

test('placement mode: ghost follows the cursor, red over the Town Center and trees, green on open grass; Esc and right click cancel', async ({ page }) => {
  const errors = collectErrors(page);
  await startMatch(page);
  await selectAllVillagers(page);
  const spots = await probeSpots(page);

  await startHousePlacement(page);
  expect(await inputMode(page)).toBe('placement');

  const ghostAt = async (w: Pt) => {
    const p = await toScreen(page, w.x, w.y);
    await page.mouse.move(p.x - 30, p.y - 20);
    await page.mouse.move(p.x, p.y, { steps: 2 });
    await frame(page);
    const g = await page.evaluate(() => window.__game!.ghost());
    expect(g).not.toBeNull();
    return g!;
  };

  // Open grass: green, footprint centred under the cursor.
  const grass = await ghostAt(spots.grass);
  expect(grass).toMatchObject({ visible: true, ok: true, reason: null, size: 2 });
  expect(grass.tileOk.every(Boolean)).toBe(true);
  expect(Math.abs(grass.tx + 1 - spots.grass.x)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(grass.ty + 1 - spots.grass.y)).toBeLessThanOrEqual(0.5);
  expect((await stats(page)).ghostTiles).toBe(4);
  await shot(page, 'wp10-09-ghost-green');

  // Over a tree: red, blocked.
  const tree = await ghostAt(spots.tree);
  expect(tree.ok).toBe(false);
  expect(tree.reason).toBe('Blocked');
  expect(tree.tileOk.some((t) => !t)).toBe(true);
  await shot(page, 'wp10-10-ghost-tree-red');

  // Over the Town Center: red.
  const tcGhost = await ghostAt(spots.tc);
  expect(tcGhost.ok).toBe(false);
  expect(tcGhost.tileOk.every((t) => !t)).toBe(true);
  await shot(page, 'wp10-11-ghost-tc-red');

  // Overlapping the Town Center's edge: invalid, with some tiles green and some red.
  const edge = await ghostAt({ x: spots.tc.x + 1.9, y: spots.tc.y + 0.2 });
  expect(edge.ok).toBe(false);
  expect(edge.tileOk.some(Boolean) && edge.tileOk.some((t) => !t)).toBe(true);
  await shot(page, 'wp10-12-ghost-edge-red');

  // Esc cancels; the ghost goes away and the mode ends.
  await page.keyboard.press('Escape');
  expect(await inputMode(page)).toBeNull();
  await frame(page);
  expect((await stats(page)).ghostTiles).toBe(0);

  // Right click cancels too and issues no order.
  await startHousePlacement(page);
  await ghostAt(spots.grass);
  const gp = await toScreen(page, spots.grass.x, spots.grass.y);
  await page.mouse.click(gp.x, gp.y, { button: 'right' });
  expect(await inputMode(page)).toBeNull();
  await step(page, 2);
  expect(await selection(page)).not.toHaveLength(0);
  const moving = await page.evaluate(() => window.__game!.state!.entities.some((e) => e.kind === 'unit' && e.owner === 1 && e.currentOrder !== null));
  expect(moving).toBe(false);

  // Left click on a valid spot issues `build` (shown as an order marker) and ends the mode.
  await startHousePlacement(page);
  await ghostAt(spots.grass);
  const added = (await stats(page)).markersAdded!;
  await page.mouse.click(gp.x, gp.y);
  expect(await inputMode(page)).toBeNull();
  expect((await stats(page)).markersAdded).toBe(added + 1);

  // Shift keeps the mode active for repeated placement.
  await startHousePlacement(page);
  await ghostAt(spots.grass);
  await page.keyboard.down('Shift');
  await page.mouse.click(gp.x, gp.y);
  await page.keyboard.up('Shift');
  expect(await inputMode(page)).toBe('placement');
  await page.keyboard.press('Escape');
  expect(await inputMode(page)).toBeNull();
  expect(errors).toEqual([]);
});

test('rally mode: the next click sets the rally and ends the mode', async ({ page }) => {
  const errors = collectErrors(page);
  await startMatch(page);
  await page.keyboard.press('KeyH');
  const spots = await probeSpots(page);
  await page.keyboard.press('KeyB');
  expect(await inputMode(page)).toBe('rally');
  const p = await toScreen(page, spots.grass.x, spots.grass.y);
  await page.mouse.click(p.x, p.y);
  expect(await inputMode(page)).toBeNull();
  // The click that set the rally did not change the selection.
  expect(await selection(page)).toHaveLength(1);
  expect(errors).toEqual([]);
});
