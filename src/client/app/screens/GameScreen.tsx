import { useEffect, useRef, useState } from 'preact/hooks';
import { registry } from '../../../data';
import type { Controller } from '../../../bot';
import type { BuildingId, GameConfig, Sim, Vec2 } from '../../../sim/types';
import { DEBUG_HOOKS_ENABLED } from '../../debug/hook';
import { entityCentre, findTownCenter } from '../../input/selection';
import { createWorldRenderer } from '../../render/renderer';
import { Hud } from '../../ui/components/Hud';
import { HudController } from '../../ui/hudController';
import type { DebugController } from '../../debug/controller';
import type { DebugPanel } from '../../debug/DebugPanel';
import type { AppHost } from '../host';
import { LOCAL_PLAYER_ID, Match } from '../match';
import type { EndScreenVM } from '../../ui/viewModel';
import { playAgainConfig } from '../setup';
import { EndScreen } from './EndScreen';
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
  controllers,
  host,
  navigate,
  hooks,
}: {
  sim: Sim;
  config: GameConfig | null;
  /** The match's AI controllers (new or restored from a save). */
  controllers: Controller[];
  host: AppHost;
  navigate: Navigate;
  hooks?: GameHooks;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [hud, setHud] = useState<HudController | null>(null);
  // F3 debug overlay: dev and e2e builds only. The module is imported on demand, so production builds never load it.
  const [debug, setDebug] = useState<{ controller: DebugController; Panel: typeof DebugPanel } | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const [end, setEnd] = useState<{ match: Match; vm: EndScreenVM } | null>(null);

  useEffect(() => {
    const parent = parentRef.current;
    if (parent === null) return;
    let match: Match | null = null;
    let controller: HudController | null = null;
    let cleanupHook: (() => void) | void;
    let debugController: DebugController | null = null;
    let offUi: (() => void) | null = null;
    let offEnd: (() => void) | null = null;
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
      match = new Match(sim, renderer, manifest, controllers);
      match.aiEnabled = host.aiEnabled;
      host.setMatch(match);
      const m = match;
      offEnd = m.onEndScreen((vm) => setEnd(vm === null ? null : { match: m, vm }));
      const ctx = (): GameHookContext => ({
        match: m,
        hud: controller as HudController,
        minimapSlot: () => document.getElementById('minimap-slot'),
      });
      controller = new HudController({
        match,
        playerId: LOCAL_PLAYER_ID,
        now: m.clock.now,
        onStartPlacement: (b) => hooks?.onStartPlacement?.(b, ctx()),
        onStartRally: () => hooks?.onStartRally?.(ctx()),
      });
      controller.start();
      // Dev and e2e builds only: after `__game.step` the HUD and the minimap's unit layer rebuild at once, so a test
      // never waits for their wall-clock timers (10 Hz and 5 Hz).
      if (DEBUG_HOOKS_ENABLED) {
        m.afterStep = () => {
          controller?.sync();
          m.minimap?.redraw();
        };
      }
      // Dev and e2e builds only: `?paused=1` starts every match paused, so tests can compare a loaded save tick for tick.
      if (DEBUG_HOOKS_ENABLED && new URLSearchParams(window.location.search).has('paused')) match.loop.paused = true;
      match.start();
      setHud(controller);
      // Written out (not via DEBUG_HOOKS_ENABLED) so the bundler drops the debug chunk from production builds.
      if (import.meta.env.DEV || import.meta.env.MODE === 'e2e') {
        const [{ DebugController }, { DebugPanel }] = await Promise.all([import('../../debug/controller'), import('../../debug/DebugPanel')]);
        if (disposed) return;
        const dc = new DebugController(m, parent, registry, LOCAL_PLAYER_ID);
        debugController = dc;
        offUi = m.input.onUiAction((action) => {
          if (action === 'toggleDebug') setDebugOpen((open) => !open);
        });
        setDebug({ controller: dc, Panel: DebugPanel });
      }
      // The HUD (and `#minimap-slot`) is rendered on the next frame.
      requestAnimationFrame(() => {
        if (!disposed && controller !== null) cleanupHook = hooks?.onMatchReady?.(ctx());
      });
    })();
    return () => {
      disposed = true;
      setHud(null);
      setDebug(null);
      setDebugOpen(false);
      setEnd(null);
      offEnd?.();
      offUi?.();
      debugController?.destroy();
      host.setMatch(null);
      if (typeof cleanupHook === 'function') cleanupHook();
      controller?.stop();
      match?.destroy();
    };
  }, [sim, host, hooks, controllers]);

  const restart = (): void =>
    navigate({ name: 'loading', source: { kind: 'new', config: config ?? configFromSim(sim) } });
  const playAgain = (): void =>
    navigate({ name: 'loading', source: { kind: 'new', config: playAgainConfig(config ?? configFromSim(sim), host.seedPinned) } });

  // Plan 8: the browser context menu is suppressed in-game.
  return (
    <div class="screen game" data-testid="game-screen" onContextMenu={(e) => e.preventDefault()}>
      <div class="canvas-host" ref={parentRef} />
      {debug !== null && debugOpen && <debug.Panel controller={debug.controller} />}
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
      {end !== null && <EndScreen vm={end.vm} onViewMap={() => end.match.closeEndScreen()} onPlayAgain={playAgain} onMainMenu={() => navigate({ name: 'menu' })} />}
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
