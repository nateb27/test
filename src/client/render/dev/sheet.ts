/**
 * Dev-only contact sheet of every generated sprite and icon.
 * `/src/client/render/dev/sheet.html?page=units|buildings|nodes|icons|fallback`
 */

import { Application, Graphics, Sprite, Text } from 'pixi.js';
import { registry } from '../../../data';
import { allIconIds, BUILDING_IDS, NODE_IDS, UNIT_IDS } from '../../art/catalog';
import type { SpriteAsset, SpriteState } from '../../art/manifest';
import { createProceduralManifest } from '../../art/procedural';

declare global {
  interface Window {
    __sheetReady?: boolean;
    __sheetInfo?: { fallbackSprites: string[]; fallbackIcons: string[] };
  }
}

const GRASS = 0x4f7a32;

interface Flow {
  app: Application;
  x: number;
  y: number;
  rowH: number;
  width: number;
}

function place(flow: Flow, asset: SpriteAsset, state: SpriteState, facing: number, frame: number, label: string, scale = 1): void {
  const anim = asset.animation(state, facing as 0);
  const tex = anim.frames[Math.min(frame, anim.frames.length - 1)]!;
  const w = tex.width * scale;
  const h = tex.height * scale;
  if (flow.x + w > flow.width) {
    flow.x = 8;
    flow.y += flow.rowH + 6;
    flow.rowH = 0;
  }
  const bg = new Graphics().rect(flow.x, flow.y, w, h + 12).fill({ color: GRASS, alpha: 1 }).stroke({ color: 0x3a5a24, width: 1 });
  flow.app.stage.addChild(bg);
  const s = new Sprite(tex);
  s.anchor.set(asset.anchor.x, asset.anchor.y);
  s.scale.set(anim.mirrorX ? -scale : scale, scale);
  s.position.set(flow.x + asset.anchor.x * w, flow.y + 12 + asset.anchor.y * h);
  flow.app.stage.addChild(s);
  const t = new Text({ text: label, style: { fontSize: 10, fill: 0xffffff, fontFamily: 'sans-serif' } });
  t.position.set(flow.x + 2, flow.y);
  flow.app.stage.addChild(t);
  flow.x += w + 6;
  flow.rowH = Math.max(flow.rowH, h + 12);
}

async function main(): Promise<void> {
  const q = new URLSearchParams(location.search);
  const page = q.get('page') ?? 'units';
  const scale = Number(q.get('scale') ?? '1') || 1;
  const manifest = createProceduralManifest({ registry });
  await manifest.load();
  const root = document.getElementById('root')!;
  window.__sheetInfo = {
    fallbackSprites: [...UNIT_IDS.map((k) => `unit.${k}`), ...BUILDING_IDS.map((k) => `building.${k}`), ...NODE_IDS.map((k) => `node.${k}`)].filter((id) => manifest.isFallback(id)),
    fallbackIcons: allIconIds().filter((id) => manifest.isFallbackIcon(id)),
  };

  if (page === 'icons') {
    const groups = new Map<string, string[]>();
    for (const id of allIconIds()) {
      const g = id.split('.')[1]!;
      (groups.get(g) ?? groups.set(g, []).get(g)!).push(id);
    }
    for (const [g, ids] of groups) {
      const h = document.createElement('h2');
      h.textContent = g;
      root.appendChild(h);
      const row = document.createElement('div');
      row.className = 'row';
      for (const id of ids) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        const img = new Image();
        img.src = manifest.iconUrl(id);
        img.width = 64;
        img.height = 64;
        const small = new Image();
        small.src = manifest.iconUrl(id);
        small.width = 32;
        small.height = 32;
        cell.append(img, small, id.split('.').pop()!);
        row.appendChild(cell);
      }
      root.appendChild(row);
    }
    // Also an unknown id, to show the fallback icon.
    const h = document.createElement('h2');
    h.textContent = 'fallback';
    root.appendChild(h);
    const img = new Image();
    img.src = manifest.iconUrl('icon.nonsense.zzz');
    img.width = 64;
    root.appendChild(img);
    await Promise.all([...root.querySelectorAll('img')].map((i) => (i as HTMLImageElement).decode().catch(() => undefined)));
    window.__sheetReady = true;
    return;
  }

  const width = 1700;
  const app = new Application();
  await app.init({ width, height: 2400, background: 0x1a2414, antialias: false, resolution: 1 });
  root.appendChild(app.canvas);
  const flow: Flow = { app, x: 8, y: 8, rowH: 0, width };

  if (page === 'units') {
    for (const k of UNIT_IDS) {
      const a = manifest.sprite(`unit.${k}`);
      for (let f = 0; f < 8; f++) place(flow, a, 'idle', f, 0, `${k} f${f}`, scale);
      flow.x = width;
      for (const [st, fr] of [['walk', 0], ['walk', 1], ['work', 0], ['work', 1], ['carry', 0]] as const) place(flow, a, st, 0, fr, `${st}${fr}`, scale);
      flow.x = width;
    }
  } else if (page === 'buildings') {
    for (const k of BUILDING_IDS) {
      const a = manifest.sprite(`building.${k}`);
      place(flow, a, 'complete', 0, 0, k, scale);
      place(flow, a, 'scaffold', 0, 0, 'scaffold', scale);
      place(flow, a, 'foundation', 0, 0, 'foundation', scale);
      flow.x = width;
    }
  } else {
    for (const k of NODE_IDS) place(flow, manifest.sprite(`node.${k}`), 'default', 0, 0, k, scale);
    place(flow, manifest.sprite('unit.nonexistent'), 'default', 0, 0, 'fallback sprite', scale);
  }
  app.renderer.resize(width, Math.ceil(flow.y + flow.rowH + 16));
  app.render();
  window.__sheetReady = true;
}

void main();
