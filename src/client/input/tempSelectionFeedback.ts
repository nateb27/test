/**
 * TEMPORARY (WP5): minimal selection visuals so selection is visible before
 * WP10's proper overlays (`render/overlays`) exist. Draws a ring or footprint
 * outline for each selected entity in `layers.groundOverlays` and the drag box
 * in `layers.worldOverlays`. WP10 should delete this module and drive its own
 * overlays from `GameInput.selection` and `GameInput.dragBox`.
 */

import { Graphics } from 'pixi.js';
import type { DataRegistry } from '../../data/schema';
import type { EntityId, PlayerId, ReadonlyEntity } from '../../sim/types';
import { footprintOf } from '../render/entities';
import { worldToScreen } from '../render/iso';
import type { WorldRendererApi } from '../render/renderer';
import type { SelectionStore } from './selection';

const OWN_COLOR = 0x62ff7a;
const OTHER_COLOR = 0xffe27a;
/** Unit ring radius in tiles; a circle of r tiles is an ellipse of r*sqrt2*32 by r*sqrt2*16 px on screen. */
const RING_RADIUS = 0.42;
const SQRT2 = Math.SQRT2;

type DragBox = { x0: number; y0: number; x1: number; y1: number } | null;

export class TempSelectionFeedback {
  private readonly rings = new Graphics();
  private readonly box = new Graphics();

  constructor(
    private readonly renderer: WorldRendererApi,
    private readonly registry: DataRegistry,
    private readonly selection: SelectionStore,
    private readonly dragBox: () => DragBox,
    private readonly owner: PlayerId,
    private readonly lookup: (id: EntityId) => ReadonlyEntity | undefined,
  ) {
    renderer.layers.groundOverlays.addChild(this.rings);
    renderer.layers.worldOverlays.addChild(this.box);
  }

  /** Redraw from the entities drawn on the last frame (call after `renderer.render`). */
  update(): void {
    const { rings, box } = this;
    rings.clear();
    box.clear();
    const ids = this.selection.ids;
    if (ids.length > 0) {
      const drawn = new Map<EntityId, (typeof this.renderer.lastDrawn)[number]>();
      for (const d of this.renderer.lastDrawn) drawn.set(d.id, d);
      for (const id of ids) {
        const d = drawn.get(id);
        if (d === undefined) continue;
        const c = worldToScreen(d.wx, d.wy);
        const color = d.owner === this.owner ? OWN_COLOR : OTHER_COLOR;
        if (d.kind === 'unit') {
          rings.ellipse(c.x, c.y, RING_RADIUS * SQRT2 * 32, RING_RADIUS * SQRT2 * 16).stroke({ width: 2, color });
        } else {
          const e = this.lookup(id);
          const h = (e === undefined ? 2 : footprintOf(this.registry, e)) / 2 + 0.1;
          const pts = [worldToScreen(d.wx, d.wy - h), worldToScreen(d.wx + h, d.wy), worldToScreen(d.wx, d.wy + h), worldToScreen(d.wx - h, d.wy)];
          rings.poly(pts.flatMap((p) => [p.x, p.y]), true).stroke({ width: 2, color });
        }
      }
    }
    const b = this.dragBox();
    if (b !== null) {
      const cam = this.renderer.camera;
      const a = cam.canvasToWorldPx(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1));
      const c = cam.canvasToWorldPx(Math.max(b.x0, b.x1), Math.max(b.y0, b.y1));
      box.rect(a.x, a.y, c.x - a.x, c.y - a.y).fill({ color: OWN_COLOR, alpha: 0.12 }).stroke({ width: 1 / cam.zoom, color: OWN_COLOR });
    }
  }

  destroy(): void {
    this.rings.destroy();
    this.box.destroy();
  }
}
