/**
 * Minimap (WP10). The HUD provides a container with id `minimap-slot`;
 * `mountMinimap({ container, ... })` fills it.
 */

export { mountMinimap, MINIMAP_REFRESH_MS } from './minimap';
export type { Minimap, MinimapDeps } from './minimap';
export { cameraOutline, clampToMap, createMinimapView, insideDiamond, minimapToWorld, worldToMinimap } from './geometry';
export type { MinimapView } from './geometry';
