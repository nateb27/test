/**
 * Draw the world only when the scene changed.
 *
 * Pixi's application redraws the whole stage on every animation frame. With software GL (the e2e and CI browsers,
 * and machines without a GPU) one full redraw of a 1280x720 world costs on the order of 100-200 ms of GPU-process
 * time, even when the game is paused and nothing moves; every frame the page waits for (a Playwright click waits for
 * several) pays it. A canvas that is not drawn to keeps showing its last frame, so a frame whose scene equals the
 * last drawn one is skipped.
 *
 * "Equal" is a signature over the display tree: per visible node its transform, alpha and tint, a sprite's texture
 * and anchor, other nodes' view-change counter (bumped when a graphics context or a text is rebuilt), plus the
 * screen size. Anything the renderer, the overlays or a later layer changes therefore triggers a draw without the
 * caller having to say so. A draw is also forced every `FORCE_EVERY` frames as a safety net for changes that bypass
 * the scene graph (a texture source re-uploaded in place).
 */

import { Sprite, UPDATE_PRIORITY, type Application, type Container } from 'pixi.js';

/** Redraw at least this often (frames) even when the signature is unchanged. */
export const FORCE_EVERY = 60;

const mix = (h: number, v: number): number => {
  // FNV-style mixing over float values; collisions between two consecutive scenes are practically impossible.
  const x = (h ^ (v * 1000003)) * 16777619;
  return x - Math.floor(x / 4294967296) * 4294967296;
};

/** Signature of a display subtree (visible nodes only: an invisible subtree draws nothing). */
export function sceneSignature(root: Container, width: number, height: number): number {
  let h = mix(mix(2166136261, width), height);
  const stack: Container[] = [root];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (!n.visible || n.alpha === 0) {
      h = mix(h, -1);
      continue;
    }
    h = mix(h, n.x);
    h = mix(h, n.y);
    h = mix(h, n.scale.x);
    h = mix(h, n.scale.y);
    h = mix(h, n.rotation);
    h = mix(h, n.alpha);
    h = mix(h, n.tint);
    if (n instanceof Sprite) {
      // A sprite's look is its texture (by identity and frame) and anchor; compared by value, so a pooled overlay
      // sprite that is reset and set back to the same values every frame does not count as a change.
      const t = n.texture;
      h = mix(h, t.uid);
      h = mix(h, t.frame.x);
      h = mix(h, t.frame.y);
      h = mix(h, n.anchor.x);
      h = mix(h, n.anchor.y);
    } else {
      // Graphics, text and the rest: Pixi's view-change counter (bumped when their content is rebuilt).
      h = mix(h, (n as unknown as { _didViewChangeTick?: number })._didViewChangeTick ?? 0);
    }
    h = mix(h, n.children.length);
    for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]!);
  }
  return h;
}

/** Replace the application's draw-every-frame ticker entry with one that draws only changed frames. Returns stats. */
export function drawOnChange(app: Application): { drawn: number; skipped: number } {
  const stats = { drawn: 0, skipped: 0 };
  let last = Number.NaN;
  let sinceDraw = 0;
  app.ticker.remove(app.render, app);
  app.ticker.add(
    () => {
      const sig = sceneSignature(app.stage, app.screen.width, app.screen.height);
      if (sig === last && ++sinceDraw < FORCE_EVERY) {
        stats.skipped++;
        return;
      }
      last = sig;
      sinceDraw = 0;
      stats.drawn++;
      app.render();
    },
    null,
    UPDATE_PRIORITY.LOW,
  );
  return stats;
}
