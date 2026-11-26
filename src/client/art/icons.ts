/** HUD icons, drawn from the same artwork as the world sprites (plan 6.1). */

import { circle, contentBounds, line, makeSurface, poly, rrect, SS, type Ctx, type Surface } from './draw';
import { drawGlyph, type GlyphName } from './glyphs';
import { C, OUTLINE, type TeamColors } from './palette';
import type { IconSpec } from './catalog';

export const ICON_SIZE = 64;

const TECH_GLYPH: Readonly<Record<string, GlyphName>> = {
  handCarts: 'cart',
  ironAxes: 'axe',
  frameSaws: 'saw',
  irrigation: 'drops',
  threeFieldSystem: 'fields',
  ironPicks: 'pick',
  timberedShafts: 'timbers',
  guildCharters: 'scroll',
};

const RESOURCE_GLYPH: Readonly<Record<string, GlyphName>> = {
  food: 'apple',
  wood: 'log',
  gold: 'coin',
  stone: 'rock',
};

type Theme = { top: string; bottom: string; border: string };

function frame(ctx: Ctx, theme: Theme): void {
  const gr = ctx.createLinearGradient(0, 0, 0, ICON_SIZE);
  gr.addColorStop(0, theme.top);
  gr.addColorStop(1, theme.bottom);
  rrect(ctx, 2, 2, ICON_SIZE - 4, ICON_SIZE - 4, 8, null, OUTLINE, 3);
  rrect(ctx, 2, 2, ICON_SIZE - 4, ICON_SIZE - 4, 8, gr as unknown as string, null);
  rrect(ctx, 3.5, 3.5, ICON_SIZE - 7, ICON_SIZE - 7, 7, null, theme.border, 2);
}

/** Draw a sprite surface (cropped to its content) centred in the icon. */
function blit(ctx: Ctx, src: Surface, pad = 7): void {
  const b = contentBounds(src);
  const room = ICON_SIZE - pad * 2;
  const k = Math.min(room / b.w, room / b.h, 1.6);
  const w = b.w * k;
  const h = b.h * k;
  ctx.drawImage(src.canvas, b.x * SS, b.y * SS, b.w * SS, b.h * SS, (ICON_SIZE - w) / 2, (ICON_SIZE - h) / 2 + 1, w, h);
}

const ROMAN = ['I', 'II', 'III', 'IV'];

export interface IconSources {
  unit(key: string): Surface | null;
  building(key: string): Surface | null;
  node(key: string): Surface | null;
}

/** Optional frame colours for sprite-based icons (the rendered art uses darker, earthier frames). */
export interface IconThemes {
  building?: { top: string; bottom: string };
  node?: { top: string; bottom: string };
}

/** Draw an icon for a resolved spec; `null` spec draws the fallback "?" tile. */
export function drawIcon(spec: IconSpec | null, team: TeamColors, src: IconSources, themes: IconThemes = {}): Surface {
  const s = makeSurface(ICON_SIZE, ICON_SIZE);
  const { ctx } = s;
  if (spec === null) {
    frame(ctx, { top: '#ff4fd8', bottom: '#8a1a74', border: '#fff' });
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 40px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', ICON_SIZE / 2, ICON_SIZE / 2 + 2);
    return s;
  }
  switch (spec.type) {
    case 'unit': {
      frame(ctx, { top: team.primaryLight, bottom: team.primaryDark, border: team.secondary });
      const u = src.unit(spec.key);
      if (u !== null) blit(ctx, u, 6);
      break;
    }
    case 'building': {
      frame(ctx, { top: themes.building?.top ?? '#d9e6c4', bottom: themes.building?.bottom ?? '#8aa56a', border: team.secondary });
      const b = src.building(spec.key);
      if (b !== null) blit(ctx, b, 5);
      break;
    }
    case 'node': {
      frame(ctx, { top: themes.node?.top ?? '#a8d27e', bottom: themes.node?.bottom ?? '#4f7a32', border: '#d8cfae' });
      const n = src.node(spec.key);
      if (n !== null) blit(ctx, n, 5);
      break;
    }
    case 'tech': {
      frame(ctx, { top: '#f3e6bd', bottom: '#c9a96a', border: team.primary });
      const glyph = TECH_GLYPH[spec.key] ?? 'scroll';
      drawGlyph(ctx, glyph, 32, 30, 20, { ink: team.primaryDark, accent: team.secondary });
      if (spec.generic) {
        ctx.fillStyle = team.primaryDark;
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(spec.key.slice(0, 3).toUpperCase(), 32, 58);
      }
      break;
    }
    case 'resource': {
      const themes: Record<string, Theme> = {
        food: { top: '#f0d98a', bottom: '#b8883a', border: '#fff2c0' },
        wood: { top: '#b98a52', bottom: '#5d3b1c', border: '#e0c08a' },
        gold: { top: '#f7e08a', bottom: '#a67c12', border: '#fff3a6' },
        stone: { top: '#c9c9c3', bottom: '#6d6d6a', border: '#e8e8e2' },
      };
      frame(ctx, themes[spec.key]!);
      drawGlyph(ctx, RESOURCE_GLYPH[spec.key]!, 32, 33, 22, { ink: '#fff', accent: C.gold });
      break;
    }
    case 'age': {
      frame(ctx, { top: team.secondaryLight, bottom: team.secondaryDark, border: team.primary });
      drawGlyph(ctx, 'pillar', 32, 24, 17, { ink: team.primaryDark, accent: team.primary });
      ctx.fillStyle = team.primaryDark;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.font = 'bold 20px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const t = ROMAN[Number(spec.key) - 1]!;
      ctx.strokeText(t, 32, 57);
      ctx.fillText(t, 32, 57);
      break;
    }
    case 'civ': {
      frame(ctx, { top: team.primaryLight, bottom: team.primaryDark, border: team.secondary });
      poly(ctx, [{ x: 17, y: 14 }, { x: 47, y: 14 }, { x: 47, y: 36 }, { x: 32, y: 52 }, { x: 17, y: 36 }], team.primary, team.secondary, 2.5);
      drawGlyph(ctx, 'cross', 32, 32, 13, { ink: team.secondary, accent: team.secondary });
      circle(ctx, 32, 11, 2.5, team.secondary, OUTLINE, 1);
      line(ctx, { x: 20, y: 22 }, { x: 44, y: 22 }, team.secondaryLight, 1);
      break;
    }
  }
  return s;
}
