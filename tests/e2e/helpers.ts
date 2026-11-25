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
