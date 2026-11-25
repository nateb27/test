/**
 * TEMPORARY (WP10): mounts the minimap into `#minimap-slot` if the HUD has
 * provided one, otherwise into a fixed bottom-left box created here, so the
 * minimap is visible before the HUD lands. The integrator removes this file and
 * the call in `app/match.ts` once the HUD's slot exists and mounts the minimap.
 */

import type { Minimap, MinimapDeps } from './minimap';
import { mountMinimap } from './minimap';

export function mountTempMinimap(deps: Omit<MinimapDeps, 'container'>): { minimap: Minimap; dispose(): void } {
  let slot = document.getElementById('minimap-slot');
  let created: HTMLElement | null = null;
  if (slot === null) {
    created = document.createElement('div');
    created.id = 'minimap-slot';
    created.style.cssText =
      'position:fixed;left:12px;bottom:12px;width:240px;height:124px;z-index:20;background:rgba(14,18,10,0.85);border:2px solid #d4af37;border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,0.5);overflow:hidden;';
    document.body.appendChild(created);
    slot = created;
  }
  const minimap = mountMinimap({ ...deps, container: slot });
  return {
    minimap,
    dispose() {
      minimap.destroy();
      created?.remove();
    },
  };
}
