import { expect, test, type Page } from '@playwright/test';
import { clickUnit, collectErrors, entities, frames, openGround, selection, shot, startMatch, step, townCenter } from './helpers';

/**
 * WP29: the military command card, the stance highlight, the combat line, the idle-military button, alerts and the
 * Resign confirmation must fit at every supported window size without overlap or clipping. Time moves only through
 * `step`; the client clock is frozen by `startMatch`. Sim combat is built elsewhere, so nothing here depends on
 * what an order does once issued: it checks what the HUD shows and, for hotkeys, what the client selects.
 */

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.w - 0.01 && b.x < a.x + a.w - 0.01 && a.y < b.y + b.h - 0.01 && b.y < a.y + a.h - 0.01;
const inside = (inner: Box, outer: Box): boolean =>
  inner.x >= outer.x - 0.01 && inner.y >= outer.y - 0.01 && inner.x + inner.w <= outer.x + outer.w + 0.01 && inner.y + inner.h <= outer.y + outer.h + 0.01;

const SIZES = [
  [800, 600],
  [1280, 720],
  [1920, 1080],
] as const;

/** Spawn an own spearman on open ground near the Town Center and select it with a real click. */
async function selectSpearman(page: Page): Promise<number> {
  const tc = await townCenter(page);
  const spot = await openGround(page, tc.x, tc.y, 2);
  await page.evaluate(([x, y]) => window.__game!.cheat.spawnUnit('spearman', x!, y!), [spot.x, spot.y] as const);
  await step(page, 2);
  const [sp] = await entities(page, { type: 'spearman', own: true });
  expect(sp).toBeDefined();
  await clickUnit(page, sp!);
  expect(await selection(page)).toEqual([sp!.id]);
  return sp!.id;
}

const rect = (page: Page, testId: string): Promise<Box> =>
  page.getByTestId(testId).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });

for (const [width, height] of SIZES) {
  test.describe(`at ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    test('military card, stance highlight, combat line and top bar fit', async ({ page }) => {
      const errors = collectErrors(page);
      await startMatch(page);
      await selectSpearman(page);

      // The five military slots: fixed positions, fully visible, inside the card, not overlapping.
      const card = await rect(page, 'command-card');
      const slots = [2, 5, 6, 10, 11];
      const boxes: Box[] = [];
      for (const n of slots) {
        const b = await rect(page, `slot-${n}`);
        expect(inside(b, card), `slot ${n} inside the card`).toBe(true);
        expect(b.w).toBeGreaterThanOrEqual(58);
        boxes.push(b);
      }
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i]!, boxes[j]!), `slots ${slots[i]} and ${slots[j]}`).toBe(false);
      }
      const parts = await page.getByTestId('command-card').evaluate((root) =>
        [2, 5, 6, 10, 11].map((n) => {
          const b = root.querySelector(`[data-testid="slot-${n}"]`) as HTMLElement;
          const box = (e: Element): { x: number; y: number; w: number; h: number } => {
            const r = e.getBoundingClientRect();
            return { x: r.x, y: r.y, w: r.width, h: r.height };
          };
          return { n, button: box(b), icon: box(b.querySelector(':scope > .icon') as Element), hotkey: box(b.querySelector('.hotkey') as Element), key: (b.querySelector('.hotkey') as HTMLElement).textContent };
        }),
      );
      expect(parts.map((p) => p.key)).toEqual(['E', 'A', 'S', 'Z', 'X']);
      for (const p of parts) {
        expect(inside(p.icon, p.button), `slot ${p.n}: icon inside`).toBe(true);
        expect(inside(p.hotkey, p.button), `slot ${p.n}: hotkey inside`).toBe(true);
        expect(overlaps(p.icon, p.hotkey), `slot ${p.n}: icon over hotkey`).toBe(false);
        expect(p.icon.w).toBeGreaterThanOrEqual(22);
      }

      // The current stance (aggressive) is highlighted and the other is not.
      await expect(page.getByTestId('slot-10')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('slot-11')).toHaveAttribute('aria-pressed', 'false');
      await expect(page.getByTestId('slot-10')).toHaveClass(/active/);

      // The selection panel shows hp, the combat line and the stance without scrolling or clipping.
      await expect(page.getByTestId('sel-combat')).toBeVisible();
      await expect(page.getByTestId('sel-stance')).toContainText('Aggressive');
      const panel = await rect(page, 'selection-panel');
      const overflow = await page.getByTestId('selection-panel').evaluate((el) => el.scrollHeight - el.clientHeight);
      expect(overflow, 'selection panel scrolls').toBeLessThanOrEqual(0);
      for (const id of ['sel-name', 'sel-hp', 'sel-combat', 'sel-stance']) {
        const b = await rect(page, id);
        expect(inside(b, panel), `${id} inside the selection panel`).toBe(true);
      }
      const combatParts = await page.getByTestId('sel-combat').evaluate((el) =>
        [...el.querySelectorAll('.combat-item')].map((c) => {
          const r = c.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height, clipped: (c as HTMLElement).scrollWidth > (c as HTMLElement).clientWidth };
        }),
      );
      expect(combatParts.length).toBeGreaterThanOrEqual(2);
      for (const c of combatParts) {
        expect(c.clipped).toBe(false);
        expect(inside(c, panel)).toBe(true);
      }
      for (let i = 0; i < combatParts.length; i++) {
        for (let j = i + 1; j < combatParts.length; j++) expect(overlaps(combatParts[i]!, combatParts[j]!)).toBe(false);
      }

      // The top bar: colour swatch and idle-military button are inside the bar, inside the window and clear of every other control.
      const bar = await rect(page, 'top-bar');
      const controls = await page.getByTestId('top-bar').evaluate((el) => {
        const out: { id: string; x: number; y: number; w: number; h: number }[] = [];
        for (const e of el.querySelectorAll('[data-testid]')) {
          const id = (e as HTMLElement).dataset.testid!;
          if (!/^(player-swatch|res-|pop$|age$|idle-|clock|speed-|pause)/.test(id)) continue;
          const r = e.getBoundingClientRect();
          out.push({ id, x: r.x, y: r.y, w: r.width, h: r.height });
        }
        return { out, scrollW: el.scrollWidth - el.clientWidth };
      });
      expect(controls.out.map((c) => c.id)).toEqual(expect.arrayContaining(['player-swatch', 'idle-villagers', 'idle-military']));
      expect(controls.scrollW).toBeLessThanOrEqual(0);
      for (const c of controls.out) {
        expect(inside(c, { x: 0, y: 0, w: width, h: bar.y + bar.h }), `${c.id} on screen`).toBe(true);
        expect(inside(c, bar), `${c.id} inside the bar`).toBe(true);
      }
      for (let i = 0; i < controls.out.length; i++) {
        for (let j = i + 1; j < controls.out.length; j++) {
          expect(overlaps(controls.out[i]!, controls.out[j]!), `${controls.out[i]!.id} over ${controls.out[j]!.id}`).toBe(false);
        }
      }
      await expect(page.getByTestId('idle-military')).toContainText('1'); // the selected spearman is still idle
      await shot(page, `wp29-military-card-${width}x${height}`);
      expect(errors).toEqual([]);
    });

    test('Town Center combat line fits next to its queue', async ({ page }) => {
      await startMatch(page);
      await page.keyboard.press('KeyH');
      await expect(page.getByTestId('sel-combat-note')).toContainText('Fires 2 arrows');
      // Six villagers queued: the queue row, the facts and the combat line all share the panel.
      await page.evaluate(() => window.__game!.cheat.addResources({ food: 2000 }));
      await step(page, 1);
      for (let i = 0; i < 6; i++) await page.keyboard.press('KeyQ');
      await step(page, 1);
      await expect(page.getByTestId('queue')).toBeVisible();
      const panel = await rect(page, 'selection-panel');
      const overflow = await page.getByTestId('selection-panel').evaluate((el) => el.scrollHeight - el.clientHeight);
      expect(overflow, 'selection panel scrolls').toBeLessThanOrEqual(0);
      for (const id of ['sel-hp', 'sel-combat', 'sel-combat-note', 'queue']) {
        expect(inside(await rect(page, id), panel), `${id} inside the selection panel`).toBe(true);
      }
      const [combat, queue] = [await rect(page, 'sel-combat'), await rect(page, 'queue')];
      expect(overlaps(combat, queue)).toBe(false);
      await shot(page, `wp29-town-center-${width}x${height}`);
    });

    test('alerts, the defeat banner and the Resign confirmation fit', async ({ page }) => {
      await startMatch(page);
      // Alert toasts and the banner are shown by events the sim only emits once combat exists, so this puts copies of the
      // real markup (same classes, the real texts) in place and measures them, like the command card layout test.
      const layout = await page.evaluate(() => {
        const box = (e: Element): { x: number; y: number; w: number; h: number } => {
          const r = e.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height };
        };
        const toasts = document.querySelector('[data-testid="toasts"]') as HTMLElement;
        const texts: [string, string][] = [
          ['error', 'Your Town Center is under attack!'],
          ['error', 'Your buildings are under attack!'],
          ['info', 'Your units are under attack!'],
          ['error', 'Siege Workshop destroyed'],
        ];
        for (const [kind, text] of texts) {
          const t = document.createElement('div');
          t.className = `toast toast-${kind}`;
          t.dataset.testid = 'toast-probe';
          t.textContent = text;
          toasts.append(t);
        }
        const banner = document.createElement('div');
        banner.className = 'banner banner-defeated';
        banner.dataset.testid = 'banner-probe';
        banner.innerHTML = '<div class="banner-title">Computer (Standard) has been defeated</div><div class="banner-sub">Their last stronghold has fallen</div>';
        document.querySelector('[data-testid="hud"]')!.append(banner);
        return {
          toasts: [...toasts.querySelectorAll('.toast')].map(box),
          banner: box(banner),
          bar: box(document.querySelector('.topbar')!),
          bottom: box(document.querySelector('.bottom .minimap-frame')!),
          selection: box(document.querySelector('.bottom .selection')!),
          card: box(document.querySelector('.bottom .card')!),
        };
      });
      const view = { x: 0, y: 0, w: width, h: height };
      const bottomTop = Math.min(layout.bottom.y, layout.selection.y, layout.card.y);
      for (const t of layout.toasts) {
        expect(inside(t, view)).toBe(true);
        expect(overlaps(t, layout.bar)).toBe(false);
        expect(t.y + t.h).toBeLessThanOrEqual(bottomTop);
      }
      for (let i = 1; i < layout.toasts.length; i++) expect(overlaps(layout.toasts[i - 1]!, layout.toasts[i]!)).toBe(false);
      expect(inside(layout.banner, view)).toBe(true);
      expect(overlaps(layout.banner, layout.bar)).toBe(false);
      expect(layout.banner.y + layout.banner.h).toBeLessThanOrEqual(bottomTop);
      for (const t of layout.toasts) expect(overlaps(t, layout.banner), 'toast over the banner').toBe(false);
      await shot(page, `wp29-alerts-${width}x${height}`);

      // Resign: menu, confirmation text, Yes and No on screen and apart; No returns to the menu with the game still paused.
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('game-menu')).toBeVisible();
      await page.getByTestId('menu-resign').click();
      await expect(page.getByTestId('resign-confirm')).toContainText('Resign this match?');
      const [yes, no, dialog] = [await rect(page, 'resign-yes'), await rect(page, 'resign-no'), await rect(page, 'resign-confirm')];
      expect(inside(yes, view) && inside(no, view)).toBe(true);
      expect(inside(yes, dialog) && inside(no, dialog)).toBe(true);
      expect(overlaps(yes, no)).toBe(false);
      await shot(page, `wp29-resign-${width}x${height}`);
      await page.getByTestId('resign-no').click();
      await expect(page.getByTestId('menu-resign')).toBeVisible();
      await expect(page.getByTestId('resign-confirm')).toHaveCount(0);
    });
  });
}

test('comma selects idle soldiers in turn; the top bar counts them', async ({ page }) => {
  await startMatch(page);
  await expect(page.getByTestId('idle-military')).toBeDisabled();
  const tc = await townCenter(page);
  const a = await openGround(page, tc.x, tc.y, 2);
  const b = await openGround(page, tc.x, tc.y + 3, 2);
  await page.evaluate(([ax, ay, bx, by]) => {
    window.__game!.cheat.spawnUnit('spearman', ax!, ay!);
    window.__game!.cheat.spawnUnit('archer', bx!, by!);
  }, [a.x, a.y, b.x + 1, b.y] as const);
  await step(page, 2);
  const soldiers = (await entities(page, { own: true, kind: 'unit' })).filter((e) => e.typeId !== 'villager').map((e) => e.id);
  expect(soldiers).toHaveLength(2);
  await expect(page.getByTestId('idle-military')).toContainText('2');
  await expect(page.getByTestId('idle-military')).toBeEnabled();

  await page.keyboard.press('Comma');
  expect(await selection(page)).toEqual([soldiers[0]]);
  await page.keyboard.press('Comma');
  expect(await selection(page)).toEqual([soldiers[1]]);
  await page.keyboard.press('Comma');
  expect(await selection(page)).toEqual([soldiers[0]]); // wraps round
  await page.getByTestId('idle-military').click();
  expect(await selection(page)).toEqual([soldiers[1]]); // the button does the same as the key
});

test('Space does nothing before the first alert', async ({ page }) => {
  await startMatch(page);
  const before = await page.evaluate(() => window.__game!.worldToScreen(60, 60));
  await page.keyboard.press('Space');
  await frames(page, 2);
  expect(await page.evaluate(() => window.__game!.worldToScreen(60, 60))).toEqual(before);
});
