import { expect, type Locator, type Page } from '@playwright/test';

/** Screenshots of every scenario go here (git-ignored); the reviewed gallery is copied to docs/screenshots/phase2/. */
export const SHOTS = 'test-results/screenshots';

export interface Pt {
  x: number;
  y: number;
}

export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

/** Menu -> New Game -> civilization select -> Start; waits until the match, HUD and minimap are up. */
export async function startMatch(page: Page, opts: { paused?: boolean } = {}): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('main-menu')).toBeVisible();
  await page.getByTestId('new-game').click();
  await page.getByTestId('start-match').click();
  await expect(page.locator('canvas.world-canvas')).toBeVisible({ timeout: 5_000 });
  await expect.poll(() => page.evaluate(() => window.__game?.state?.entities.length ?? 0)).toBeGreaterThan(10);
  await expect(page.getByTestId('hud')).toBeVisible();
  await expect(page.getByTestId('minimap')).toBeVisible();
  await frames(page, 2);
  if (opts.paused) await setPaused(page, true);
}

export const frames = (page: Page, n = 2): Promise<unknown> =>
  page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        const next = (left: number): void => {
          if (left <= 0) resolve();
          else requestAnimationFrame(() => next(left - 1));
        };
        next(count);
      }),
    n,
  );

export const setPaused = (page: Page, paused: boolean): Promise<void> => page.evaluate((p) => window.__game!.setPaused(p), paused);

/** Advance the sim by `n` ticks (commands buffered by earlier clicks are consumed first) and redraw. */
export const step = (page: Page, n: number): Promise<void> => page.evaluate((count) => window.__game!.step(count), n);

export const tick = (page: Page): Promise<number> => page.evaluate(() => window.__game!.state!.tick);

export const toScreen = (page: Page, x: number, y: number): Promise<Pt> =>
  page.evaluate(([wx, wy]) => window.__game!.worldToScreen(wx!, wy!), [x, y] as const);

export const toMinimap = (page: Page, x: number, y: number): Promise<Pt> =>
  page.evaluate(([wx, wy]) => window.__game!.minimapToPage(wx!, wy!), [x, y] as const);

export const selection = (page: Page): Promise<number[]> => page.evaluate(() => [...(window.__game?.selection ?? [])]);

export const overlayStats = (page: Page): Promise<Record<string, number>> => page.evaluate(() => window.__game!.overlayStats());

export const inputMode = (page: Page): Promise<'placement' | 'rally' | null> => page.evaluate(() => window.__game!.inputMode());

export const resources = (page: Page): Promise<{ food: number; wood: number; gold: number; stone: number }> =>
  page.evaluate(() => ({ ...window.__game!.state!.players[1]!.resources }));

export const player = (page: Page): Promise<{ popUsed: number; popCap: number; age: number; researched: string[] }> =>
  page.evaluate(() => {
    const p = window.__game!.state!.players[1]!;
    return { popUsed: p.popUsed, popCap: p.popCap, age: p.age, researched: [...p.researched] };
  });

export interface Entry {
  id: number;
  kind: 'unit' | 'building' | 'node';
  typeId: string;
  x: number;
  y: number;
  /** Footprint side for buildings and nodes, 0 for units (from the data defaults used in tests). */
  size: number;
  constructed: boolean;
}

/** Own entities (and nodes when `all`) as plain objects: centre in tiles. */
export function entities(page: Page, filter: { type?: string; own?: boolean; kind?: 'unit' | 'building' | 'node' } = {}): Promise<Entry[]> {
  return page.evaluate((f) => {
    const sizes: Record<string, number> = {
      townCenter: 4, house: 2, mill: 2, lumberCamp: 2, miningCamp: 2, farm: 2, barracks: 3, archeryRange: 3, stable: 3,
      siegeWorkshop: 3, silkWorkshop: 3, goldDeposit: 2, stoneDeposit: 2, tree: 1, berryBush: 1,
    };
    const out: Entry[] = [];
    for (const e of window.__game!.state!.entities) {
      if (f.kind !== undefined && e.kind !== f.kind) continue;
      if (f.type !== undefined && e.typeId !== f.type) continue;
      if (f.own === true && e.owner !== 1) continue;
      if (e.kind === 'unit') out.push({ id: e.id, kind: 'unit', typeId: e.typeId, x: e.pos.x, y: e.pos.y, size: 0, constructed: true });
      else {
        const size = sizes[e.typeId] ?? 1;
        out.push({ id: e.id, kind: e.kind, typeId: e.typeId, x: e.tile.tx + size / 2, y: e.tile.ty + size / 2, size, constructed: e.kind === 'building' ? e.constructed : true });
      }
    }
    return out;
  }, filter);
}

export const villagers = (page: Page): Promise<Entry[]> => entities(page, { type: 'villager', own: true });

export async function townCenter(page: Page): Promise<Entry> {
  const [tc] = await entities(page, { type: 'townCenter', own: true });
  if (tc === undefined) throw new Error('no town center');
  return tc;
}

/** Click a unit at its body (a little above the feet) with the real mouse. */
export async function clickUnit(page: Page, e: { x: number; y: number }): Promise<void> {
  const p = await toScreen(page, e.x, e.y);
  await page.mouse.click(p.x, p.y - 14);
}

/** Double-click the front-most villager: selects every visible villager. */
export async function selectAllVillagers(page: Page): Promise<number[]> {
  const vs = await villagers(page);
  const front = [...vs].sort((a, b) => b.x + b.y - (a.x + a.y))[0]!;
  const p = await toScreen(page, front.x, front.y);
  await page.mouse.dblclick(p.x, p.y - 14);
  const sel = await selection(page);
  expect(sel).toHaveLength(vs.length);
  return sel;
}

/** Click one specific villager with a plain click. */
export async function selectVillager(page: Page, id: number): Promise<void> {
  const v = (await villagers(page)).find((e) => e.id === id)!;
  await clickUnit(page, v);
  expect(await selection(page)).toEqual([id]);
}

export const slot = (page: Page, n: number): Locator => page.getByTestId(`slot-${n}`);

export const cheat = {
  resources: (page: Page, amounts: Partial<Record<'food' | 'wood' | 'gold' | 'stone', number>>): Promise<void> =>
    page.evaluate((a) => window.__game!.cheat.addResources(a), amounts),
};

/** True when the page point is over a HUD panel (so a canvas click there would be swallowed). */
export const overHud = (page: Page, x: number, y: number): Promise<boolean> =>
  page.evaluate(([px, py]) => {
    const el = document.elementFromPoint(px!, py!);
    return el !== null && el.closest('.panel, .toast, .banner, .modal-backdrop') !== null;
  }, [x, y] as const);

/**
 * A world point near (cx, cy) whose screen position is on the canvas, clear of HUD panels and of every entity
 * (building or node within `margin` tiles), for clicks that must land on open grass.
 */
export function openGround(page: Page, cx: number, cy: number, margin = 3): Promise<{ x: number; y: number; sx: number; sy: number }> {
  return page.evaluate(
    ([px, py, m]) => {
      const g = window.__game!;
      const sizes: Record<string, number> = { townCenter: 4, goldDeposit: 2, stoneDeposit: 2, house: 2, farm: 2, lumberCamp: 2, mill: 2, miningCamp: 2, barracks: 3, archeryRange: 3, stable: 3, siegeWorkshop: 3, silkWorkshop: 3 };
      const ents = g.state!.entities;
      for (let r = 4; r <= 24; r++) {
        for (let a = 0; a < 32; a++) {
          const x = Math.round(px! + Math.cos((a * Math.PI) / 16) * r) + 0.5;
          const y = Math.round(py! + Math.sin((a * Math.PI) / 16) * r) + 0.5;
          if (x < 3 || y < 3 || x > 117 || y > 117) continue;
          const s = g.worldToScreen(x, y);
          if (s.x < 60 || s.x > window.innerWidth - 60 || s.y < 90 || s.y > window.innerHeight - 280) continue;
          const clear = ents.every((e) => {
            const size = e.kind === 'unit' ? 0 : (sizes[e.typeId] ?? 1);
            const ex = e.kind === 'unit' ? e.pos.x : e.tile.tx + size / 2;
            const ey = e.kind === 'unit' ? e.pos.y : e.tile.ty + size / 2;
            return Math.hypot(ex - x, ey - y) > m! + size / 2 + (e.kind === 'unit' ? 1 : 0);
          });
          if (clear) return { x, y, sx: s.x, sy: s.y };
        }
      }
      throw new Error('no open ground on screen');
    },
    [cx, cy, margin] as const,
  );
}

export const shot = (page: Page, name: string): Promise<Buffer> => page.screenshot({ path: `${SHOTS}/${name}.png` });

// ---------------------------------------------------------------------------
// Driving the real UI
// ---------------------------------------------------------------------------

/** A command card button by its label ("Lumber Camp", "Economy", "Set Rally"). */
export const card = (page: Page, label: string): Locator => page.locator(`[data-testid="command-card"] button[aria-label^="${label} ("]`);

/**
 * Step the sim in chunks until `expr` (a JS expression over `g = window.__game`) is true.
 * Fails after `max` ticks. Returns the ticks stepped.
 */
export async function stepUntil(page: Page, expr: string, max = 6000, chunk = 20): Promise<number> {
  const stepped = await page.evaluate(
    ([code, limit, size]) => {
      const g = window.__game!;
      const test = new Function('g', `return (${code});`) as (g: unknown) => boolean;
      let n = 0;
      while (!test(g)) {
        if (n >= (limit as number)) return -1;
        g.step(size as number);
        n += size as number;
      }
      return n;
    },
    [expr, max, chunk] as const,
  );
  if (stepped < 0) throw new Error(`stepUntil timed out after ${max} ticks: ${expr}`);
  return stepped;
}

/** Select the six starting villagers with a double click and bind them to control group 1 (`Digit1` recalls them). */
export async function groupVillagers(page: Page): Promise<number[]> {
  const ids = await selectAllVillagers(page);
  await page.keyboard.press('Control+Digit1');
  return ids;
}

export async function recallVillagers(page: Page): Promise<void> {
  await page.keyboard.press('Digit1');
}

/**
 * Candidate screen points for a building near world (cx, cy): on the canvas, clear of HUD panels, in rings of
 * growing distance from the anchor, skipping spots too close to existing buildings or nodes of the same neighbourhood.
 */
async function candidates(page: Page, cx: number, cy: number, size: number, minRing: number): Promise<Pt[]> {
  return page.evaluate(
    ([ax, ay, sz, ring0]) => {
      const g = window.__game!;
      const sizes: Record<string, number> = {
        townCenter: 4, house: 2, mill: 2, lumberCamp: 2, miningCamp: 2, farm: 2, barracks: 3, archeryRange: 3, stable: 3,
        siegeWorkshop: 3, silkWorkshop: 3, goldDeposit: 2, stoneDeposit: 2, tree: 1, berryBush: 1,
      };
      const others = g.state!.entities
        .flatMap((e) => {
          if (e.kind === 'unit') return [];
          const s = sizes[e.typeId] ?? 1;
          return [{ x: e.tile.tx + s / 2, y: e.tile.ty + s / 2, s }];
        });
      const out: { x: number; y: number }[] = [];
      for (let r = ring0!; r <= 22; r++) {
        for (let a = 0; a < 48; a++) {
          const wx = (ax as number) + Math.cos((a * Math.PI) / 24) * r;
          const wy = (ay as number) + Math.sin((a * Math.PI) / 24) * r;
          const tx = Math.round(wx - (sz as number) / 2) + (sz as number) / 2;
          const ty = Math.round(wy - (sz as number) / 2) + (sz as number) / 2;
          if (tx < 4 || ty < 4 || tx > 116 || ty > 116) continue;
          const s = g.worldToScreen(tx, ty);
          if (s.x < 80 || s.x > window.innerWidth - 80 || s.y < 100 || s.y > window.innerHeight - 260) continue;
          // Keep one free tile around every neighbour (never wall a builder in), nodes included.
          const clear = others.every((o) => Math.max(Math.abs(o.x - tx), Math.abs(o.y - ty)) >= (o.s + (sz as number)) / 2 + 1);
          if (clear) out.push({ x: s.x, y: s.y });
        }
      }
      return out;
    },
    [cx, cy, size, minRing] as const,
  );
}

/** Move the mouse over candidate spots until the placement ghost says the spot is valid; returns that screen point. */
export async function validGhostSpot(page: Page, cx: number, cy: number, size: number, minRing = 3): Promise<Pt> {
  const list = await candidates(page, cx, cy, size, minRing);
  for (const p of list) {
    await page.mouse.move(p.x, p.y);
    await frames(page, 1);
    const g = await page.evaluate(() => window.__game!.ghost());
    if (g !== null && g.visible && g.ok) return p;
  }
  throw new Error(`no valid ${size}x${size} spot near ${cx},${cy} (${list.length} candidates)`);
}

export interface PlaceOptions {
  /** Button labels to click before the building ("Economy" or "Military"). */
  menu: 'Economy' | 'Military';
  /** The building's card label ("House"). */
  label: string;
  size: number;
  near: { x: number; y: number };
  minRing?: number;
  /** Screenshot name taken while the ghost is green, before the click. */
  ghostShot?: string;
  /** Run until the foundation completes (default true). */
  complete?: boolean;
}

/** The own building entries of a type (all, or completed only). */
export const buildingsOf = (page: Page, type: string): Promise<Entry[]> => entities(page, { type, own: true, kind: 'building' });

/**
 * With builders selected: click the page button, the building button, move to a valid ghost spot, click.
 * Steps the sim until the building is complete. Returns the new building's entry.
 */
export async function placeViaCard(page: Page, o: PlaceOptions): Promise<Entry> {
  const before = new Set((await buildingsOf(page, o.label === 'House' ? 'house' : typeIdOf(o.label))).map((b) => b.id));
  // The card stays on the build page after a placement (handy for placing more): go back first if it is the other one.
  if ((await card(page, o.label).count()) === 0) {
    if ((await card(page, o.menu).count()) === 0) await card(page, 'Back').click();
    await card(page, o.menu).click();
  }
  await card(page, o.label).click();
  expect(await inputMode(page)).toBe('placement');
  const spot = await validGhostSpot(page, o.near.x, o.near.y, o.size, o.minRing ?? 3);
  if (o.ghostShot !== undefined) await shot(page, o.ghostShot);
  await page.mouse.click(spot.x, spot.y);
  expect(await inputMode(page)).toBeNull();
  await step(page, 2);
  const type = typeIdOf(o.label);
  const placed = (await buildingsOf(page, type)).find((b) => !before.has(b.id));
  if (placed === undefined) throw new Error(`${o.label} was not placed`);
  if (o.complete !== false) {
    await stepUntil(
      page,
      `g.state.entities.some((e) => e.id === ${placed.id} && e.constructed)`,
      9000,
    );
  }
  return placed;
}

const LABEL_TO_TYPE: Record<string, string> = {
  House: 'house',
  Mill: 'mill',
  'Lumber Camp': 'lumberCamp',
  'Mining Camp': 'miningCamp',
  Farm: 'farm',
  Barracks: 'barracks',
  'Archery Range': 'archeryRange',
  Stable: 'stable',
  'Siege Workshop': 'siegeWorkshop',
  'Silk Workshop': 'silkWorkshop',
};
const typeIdOf = (label: string): string => {
  const t = LABEL_TO_TYPE[label];
  if (t === undefined) throw new Error(`unknown building label ${label}`);
  return t;
};

/** Select an own building by clicking it on the canvas (a point on its footprint). */
export async function clickBuilding(page: Page, b: Entry): Promise<void> {
  const p = await toScreen(page, b.x, b.y);
  await page.mouse.click(p.x, p.y);
  expect(await selection(page)).toEqual([b.id]);
}

/** The toast texts currently shown. */
export const toasts = (page: Page): Promise<string[]> => page.getByTestId('toast').allTextContents();

export const topBarNumber = async (page: Page, id: 'res-food' | 'res-wood' | 'res-gold' | 'res-stone' | 'pop'): Promise<string> =>
  (await page.getByTestId(id).textContent())?.replace(/[^0-9/]/g, '') ?? '';

/** Centre the camera on a world point with a real click on the minimap. */
export async function centreCamera(page: Page, x: number, y: number): Promise<void> {
  const m = await toMinimap(page, x, y);
  await page.mouse.click(m.x, m.y);
  await frames(page, 3);
}
