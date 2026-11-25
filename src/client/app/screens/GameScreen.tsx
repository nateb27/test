import { useEffect, useRef, useState } from 'preact/hooks';
import { registry } from '../../../data';
import type { BuildingId, GameConfig, Sim, Vec2 } from '../../../sim/types';
import { entityCentre, findTownCenter } from '../../input/selection';
import { createWorldRenderer } from '../../render/renderer';
import { Hud } from '../../ui/components/Hud';
import { HudController } from '../../ui/hudController';
import type { AppHost } from '../host';
import { LOCAL_PLAYER_ID, Match } from '../match';
import { configFromSim, type Navigate } from './types';

/** What a hook implementation (WP10) gets to work with. */
export interface GameHookContext {
  match: Match;
  hud: HudController;
  /** The empty `#minimap-slot` container in the bottom HUD. */
  minimapSlot(): HTMLElement | null;
}

/**
 * Integration points for features implemented outside the HUD. Every hook is
 * optional and defaults to doing nothing.
 */
export interface GameHooks {
  /** A Build button was clicked (or its hotkey pressed): enter placement mode. */
  onStartPlacement?(buildingType: BuildingId, ctx: GameHookContext): void;
  /** Set Rally was clicked: enter "click to set rally point" mode. */
  onStartRally?(ctx: GameHookContext): void;
  /** The match and HUD exist: mount the minimap into `ctx.minimapSlot()`. Return a cleanup function. */
  onMatchReady?(ctx: GameHookContext): (() => void) | void;
}

/** The match: full-window Pixi canvas with the HUD above it. */
export function GameScreen({
  sim,
  config,
  host,
  navigate,
  hooks,
}: {
  sim: Sim;
  config: GameConfig | null;
  host: AppHost;
  navigate: Navigate;
  hooks?: GameHooks;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [hud, setHud] = useState<HudController | null>(null);

  useEffect(() => {
    const parent = parentRef.current;
    if (parent === null) return;
    let match: Match | null = null;
    let controller: HudController | null = null;
    let cleanupHook: (() => void) | void;
    let disposed = false;
    void (async () => {
      const manifest = await host.loadManifest();
      const renderer = await createWorldRenderer({
        parent,
        manifest,
        mapWidth: sim.state.map.width,
        mapHeight: sim.state.map.height,
        registry,
        focus: startFocus(sim),
      });
      if (disposed) {
        renderer.destroy();
        return;
      }
      match = new Match(sim, renderer, manifest);
      host.setMatch(match);
      const m = match;
      const ctx = (): GameHookContext => ({
        match: m,
        hud: controller as HudController,
        minimapSlot: () => document.getElementById('minimap-slot'),
      });
      controller = new HudController({
        match,
        playerId: LOCAL_PLAYER_ID,
        onStartPlacement: (b) => hooks?.onStartPlacement?.(b, ctx()),
        onStartRally: () => hooks?.onStartRally?.(ctx()),
      });
      controller.start();
      match.start();
      setHud(controller);
      // The HUD (and `#minimap-slot`) is rendered on the next frame.
      requestAnimationFrame(() => {
        if (!disposed && controller !== null) cleanupHook = hooks?.onMatchReady?.(ctx());
      });
    })();
    return () => {
      disposed = true;
      setHud(null);
      host.setMatch(null);
      if (typeof cleanupHook === 'function') cleanupHook();
      controller?.stop();
      match?.destroy();
    };
  }, [sim, host, hooks]);

  const restart = (): void =>
    navigate({ name: 'loading', source: { kind: 'new', config: config ?? configFromSim(sim) } });

  // Plan 8: the browser context menu is suppressed in-game.
  return (
    <div class="screen game" data-testid="game-screen" onContextMenu={(e) => e.preventDefault()}>
      <div class="canvas-host" ref={parentRef} />
      {hud !== null && (
        <Hud
          controller={hud}
          iconUrl={host.iconUrl}
          storage={host.platform.storage}
          sim={sim}
          onRestart={restart}
          onQuit={() => navigate({ name: 'menu' })}
          onLoaded={(loaded) => navigate({ name: 'loading', source: { kind: 'sim', sim: loaded } })}
        />
      )}
    </div>
  );
}

/** Camera start: the centre of the local player's first building (the Town Center). */
function startFocus(sim: Sim): Vec2 {
  const tc = findTownCenter(sim.state.entities, LOCAL_PLAYER_ID, registry);
  if (tc !== null) return entityCentre(tc, registry);
  const half = sim.state.map.width / 2;
  return { x: half, y: sim.state.map.height / 2 };
}
