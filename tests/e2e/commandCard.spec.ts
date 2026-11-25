import { expect, test, type Page } from '@playwright/test';
import { card, collectErrors, shot, startMatch } from './helpers';

/**
 * Command-card button layout: the item icon, the hotkey letter and up to four cost rows must each be fully
 * visible and must not overlap, at the smallest supported window and at common larger ones. The worst cases in the
 * data are the age researches at the Town Center (three to four costs); each is also padded to four costs by copying
 * a cost into the real button (same markup, same CSS).
 */

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (inner: Box, outer: Box): boolean =>
  inner.x >= outer.x - 0.01 && inner.y >= outer.y - 0.01 && inner.x + inner.w <= outer.x + outer.w + 0.01 && inner.y + inner.h <= outer.y + outer.h + 0.01;

interface Layout {
  button: Box;
  icon: Box;
  hotkey: Box;
  costs: Box[];
  costRow: Box;
  /** The cost row's content is wider than its box (something would be cut off). */
  rowClipped: boolean;
  cardRight: number;
  cardBottom: number;
}

/** Measure the button labelled `label`; `extraCosts` appends copies of its last cost first (a temporary change to the DOM). */
async function measure(page: Page, label: string, extraCosts: number): Promise<Layout> {
  const handle = await card(page, label).elementHandle();
  if (handle === null) throw new Error(`no button ${label}`);
  return handle.evaluate((el, extra) => {
    const box = (e: Element): { x: number; y: number; w: number; h: number } => {
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    const row = el.querySelector('.cost-row') as HTMLElement;
    for (let i = 0; i < extra; i++) {
      const last = row.querySelector('.cost:last-child') as HTMLElement;
      row.append(last.cloneNode(true));
      row.dataset.costs = String(row.querySelectorAll('.cost').length);
    }
    const grid = el.closest('.card') as HTMLElement;
    const g = grid.getBoundingClientRect();
    return {
      button: box(el),
      icon: box(el.querySelector(':scope > .icon') as Element),
      hotkey: box(el.querySelector('.hotkey') as Element),
      costs: [...row.querySelectorAll('.cost')].map(box),
      costRow: box(row),
      rowClipped: row.scrollWidth > row.clientWidth || row.scrollHeight > row.clientHeight,
      cardRight: g.right,
      cardBottom: g.bottom,
    };
  }, extraCosts);
}

for (const [width, height] of [
  [800, 600],
  [1280, 720],
  [1920, 1080],
] as const) {
  test(`command card buttons with three and four costs are fully visible at ${width}x${height}`, async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width, height });
    await startMatch(page);
    await page.keyboard.press('KeyH'); // select the Town Center
    await expect(card(page, 'Empire Age')).toBeVisible();

    // The age buttons are the costliest cards; whatever their real cost count, also check a copy padded to four costs.
    for (const label of ['Township Age', 'Citadel Age', 'Empire Age']) {
      const real = await measure(page, label, 0);
      for (const l of [real, await measure(page, label, 4 - real.costs.length)]) {
        const what = `${label} with ${l.costs.length} costs`;
        expect(l.costs.length, what).toBeGreaterThanOrEqual(1);
        expect(l.rowClipped, `${what}: cost row clipped`).toBe(false);
        for (const part of [l.icon, l.hotkey, l.costRow, ...l.costs]) expect(inside(part, l.button), `${what}: inside the button`).toBe(true);
        for (const c of l.costs) expect(inside(c, l.costRow), `${what}: cost inside its row`).toBe(true);
        expect(overlaps(l.icon, l.hotkey), `${what}: icon over hotkey`).toBe(false);
        for (const c of l.costs) {
          expect(overlaps(c, l.icon), `${what}: cost over icon`).toBe(false);
          expect(overlaps(c, l.hotkey), `${what}: cost over hotkey`).toBe(false);
        }
        for (let i = 0; i < l.costs.length; i++) {
          for (let j = i + 1; j < l.costs.length; j++) expect(overlaps(l.costs[i]!, l.costs[j]!), `${what}: costs ${i} and ${j}`).toBe(false);
        }
        // The icon is big enough to recognise and the card itself is on screen.
        expect(l.icon.w).toBeGreaterThanOrEqual(22);
        expect(l.cardRight).toBeLessThanOrEqual(width);
        expect(l.cardBottom).toBeLessThanOrEqual(height);
      }
    }
    await shot(page, `command-card-${width}x${height}`);
    expect(errors).toEqual([]);
  });
}
