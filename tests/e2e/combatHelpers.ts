import { expect, type Page } from '@playwright/test';
import { advanceClock, centreCamera, overHud, SEPARATE_MS, selection, startMatch, step, toScreen, townCenter, type Pt } from './helpers';

/**
 * Helpers of the combat specs (PLAN-M2 8.2; `combat.spec.ts`, `wp34.spec.ts`): two-player matches with the AI off
 * (`?opponent=standard&ai=off`, so player 2 has a Town Center and villagers but issues nothing), units spawned with
 * `cheat.spawnUnit`, real clicks on points verified with `pickAt`.
 */

export const OPPONENT = { opponent: 'standard', ai: 'off' } as const;
export const ENEMY = 2;

export type Spawn = readonly [type: string, x: number, y: number];

/** Spawn units for `owner` (cheat), run the tick that applies it, and return the new ids in spawn order. */
export async function spawn(page: Page, list: readonly Spawn[], owner = 1): Promise<number[]> {
  const before = await page.evaluate(() => window.__game!.state!.entities.reduce((m, e) => Math.max(m, e.id), 0));
  await page.evaluate(
    ([l, o]) => {
      for (const [t, x, y] of l as Spawn[]) window.__game!.cheat.spawnUnit(t as never, x, y, o as number);
    },
    [list, owner] as const,
  );
  await step(page, 1);
  const ids = await page.evaluate(
    ([b, o]) => window.__game!.state!.entities.filter((e) => e.id > (b as number) && e.kind === 'unit' && e.owner === o).map((e) => e.id),
    [before, owner] as const,
  );
  expect(ids, 'every spawn landed on a free tile').toHaveLength(list.length);
  return ids;
}

export interface Unit {
  id: number;
  x: number;
  y: number;
  hp: number;
  owner: number;
  order: string | null;
  target: number | null;
  stance: string;
}

/** A unit's live facts, or null once it is gone. */
export const unit = (page: Page, id: number): Promise<Unit | null> =>
  page.evaluate((i) => {
    const e = window.__game!.state!.entities.find((x) => x.id === i);
    if (e === undefined || e.kind !== 'unit') return null;
    const o = e.currentOrder as { type: string; targetId?: number } | null;
    return { id: e.id, x: e.pos.x, y: e.pos.y, hp: e.hp, owner: e.owner, order: o?.type ?? null, target: o?.targetId ?? null, stance: e.stance };
  }, id);

export const units = async (page: Page, ids: readonly number[]): Promise<Unit[]> => (await Promise.all(ids.map((i) => unit(page, i)))).filter((u): u is Unit => u !== null);

export const hpOf = (page: Page, id: number): Promise<number | null> =>
  page.evaluate((i) => {
    const e = window.__game!.state!.entities.find((x) => x.id === i);
    return e === undefined || e.kind === 'node' ? null : e.hp;
  }, id);

export const gone = (id: number): string => `!g.state.entities.some((e) => e.id === ${id})`;
export const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Where a click verifiably picks entity `id` (its body a little above the feet, or its footprint), else throws. */
export async function pointOn(page: Page, id: number): Promise<Pt> {
  const c = await page.evaluate((i) => {
    const e = window.__game!.state!.entities.find((x) => x.id === i)!;
    const sizes: Record<string, number> = { townCenter: 4, house: 2, barracks: 3 };
    return e.kind === 'unit' ? { x: e.pos.x, y: e.pos.y, unit: true } : { x: e.tile.tx + (sizes[e.typeId] ?? 1) / 2, y: e.tile.ty + (sizes[e.typeId] ?? 1) / 2, unit: false };
  }, id);
  const base = await toScreen(page, c.x, c.y);
  const offsets = c.unit ? [-14, -10, -18, -6, -22, -2] : [0, -10, 10, -20];
  for (const dy of offsets) {
    const p = { x: base.x, y: base.y + dy };
    if (await overHud(page, p.x, p.y)) continue;
    if ((await page.evaluate(([x, y]) => window.__game!.pickAt(x!, y!), [p.x, p.y] as const)) === id) return p;
  }
  throw new Error(`no point on screen picks entity ${id}`);
}

/** Left-click (optionally with Shift) or right-click an entity at a verified point. */
export async function clickEntity(page: Page, id: number, opts: { button?: 'left' | 'right'; shift?: boolean } = {}): Promise<void> {
  const p = await pointOn(page, id);
  await advanceClock(page, SEPARATE_MS);
  if (opts.shift === true) await page.keyboard.down('Shift');
  await page.mouse.click(p.x, p.y, { button: opts.button ?? 'left' });
  if (opts.shift === true) await page.keyboard.up('Shift');
}

/** Select exactly these own units: a click on the first, Shift-clicks on the rest. */
export async function selectUnits(page: Page, ids: readonly number[]): Promise<void> {
  for (let i = 0; i < ids.length; i++) await clickEntity(page, ids[i]!, { shift: i > 0 });
  expect(await selection(page)).toEqual([...ids].sort((a, b) => a - b));
}

/**
 * A clear world point near (cx, cy), at least `rMin` tiles away, with `margin` tiles clear of everything, whose screen
 * point is on the canvas, off the HUD and picks nothing (a click there is a ground click).
 */
export function clearSpot(page: Page, cx: number, cy: number, rMin: number, margin = 2): Promise<Pt> {
  return page.evaluate(
    ([px, py, r0, m]) => {
      const g = window.__game!;
      const s = g.state!;
      const sizes: Record<string, number> = { townCenter: 4, goldDeposit: 2, stoneDeposit: 2, house: 2, farm: 2, lumberCamp: 2, mill: 2, miningCamp: 2, barracks: 3 };
      for (let r = r0!; r <= r0! + 14; r++) {
        for (let a = 0; a < 32; a++) {
          const x = Math.floor(px! + Math.cos((a * Math.PI) / 16) * r) + 0.5;
          const y = Math.floor(py! + Math.sin((a * Math.PI) / 16) * r) + 0.5;
          if (x < 3 || y < 3 || x > s.map.width - 3 || y > s.map.height - 3) continue;
          const sc = g.worldToScreen(x, y);
          if (sc.x < 80 || sc.x > window.innerWidth - 80 || sc.y < 100 || sc.y > window.innerHeight - 280) continue;
          // A click there is a ground click: no sprite drawn over it, no HUD panel above it.
          if (g.pickAt(sc.x, sc.y) !== null) continue;
          const el = document.elementFromPoint(sc.x, sc.y);
          if (el !== null && el.closest('.panel, .toast, .banner, .modal-backdrop') !== null) continue;
          const clear = s.entities.every((e) => {
            const size = e.kind === 'unit' ? 0 : (sizes[e.typeId] ?? 1);
            const ex = e.kind === 'unit' ? e.pos.x : e.tile.tx + size / 2;
            const ey = e.kind === 'unit' ? e.pos.y : e.tile.ty + size / 2;
            return Math.max(Math.abs(ex - x), Math.abs(ey - y)) > m! + size / 2;
          });
          if (clear) return { x, y };
        }
      }
      throw new Error('no clear spot on screen');
    },
    [cx, cy, rMin, margin] as const,
  );
}

/**
 * A two-player match, paused, camera on a clear spot out of the own Town Center's arrow range (7 tiles from its
 * centre plus reach) but near it; returns that spot.
 */
export async function fightGround(page: Page): Promise<Pt> {
  await startMatch(page, OPPONENT);
  const tc = await townCenter(page);
  await centreCamera(page, tc.x + 8, tc.y + 8);
  const spot = await clearSpot(page, tc.x, tc.y, 13, 3);
  await centreCamera(page, spot.x, spot.y);
  return clearSpot(page, spot.x, spot.y, 0, 3);
}

export const effects = (page: Page): Promise<{ projectiles: number; corpses: number; rubble: number; fires: number; effects: number }> =>
  page.evaluate(() => window.__game!.effects());
