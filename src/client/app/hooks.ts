/**
 * The integration hooks of the game screen (plan 7): HUD Build / Set Rally
 * buttons enter the WP10 input modes, refused placement clicks become toasts
 * and the minimap is mounted into the HUD's `#minimap-slot`.
 */

import { registry } from '../../data';
import { mountMinimap } from '../ui/minimap';
import { LOCAL_PLAYER_ID } from './match';
import type { GameHooks } from './screens/GameScreen';

export const gameHooks: GameHooks = {
  onStartPlacement(buildingType, ctx) {
    ctx.match.modes.startPlacement(buildingType);
    ctx.hud.setPlacing(buildingType);
  },

  onStartRally(ctx) {
    ctx.match.modes.startRally();
  },

  onMatchReady(ctx) {
    const { match, hud } = ctx;
    const cleanup: (() => void)[] = [];
    match.onInvalid = (text) => hud.toast('error', text);
    cleanup.push(() => {
      match.onInvalid = () => {};
    });
    cleanup.push(
      match.onModeChange((mode) => {
        hud.setPlacing(mode !== null && mode.kind === 'placement' ? mode.buildingType : null);
      }),
    );
    // The HUD renders on the first frames after the match starts; wait for its slot.
    let frames = 0;
    let raf = 0;
    const mount = (): void => {
      const slot = ctx.minimapSlot();
      if (slot === null) {
        if (++frames < 120) raf = requestAnimationFrame(mount);
        return;
      }
      const minimap = mountMinimap({
        container: slot,
        getState: () => match.sim.state,
        registry,
        playerId: LOCAL_PLAYER_ID,
        renderer: match.renderer,
        input: match.input,
      });
      match.minimap = minimap;
      cleanup.push(() => {
        minimap.destroy();
        if (match.minimap === minimap) match.minimap = null;
      });
    };
    mount();
    cleanup.push(() => cancelAnimationFrame(raf));
    return () => {
      for (const c of cleanup) c();
    };
  },
};
