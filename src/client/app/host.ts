/**
 * App-level state outside the Preact tree: platform services, the current
 * screen name and the running match. Backs the `window.__game` hook.
 */

import { registry } from '../../data';
import { hashState } from '../../sim/hash';
import type { TeamAssetManifest } from '../art/procedural';
import { type GameDebugHook, type ScreenName } from '../debug/hook';
import type { Platform } from '../platform';
import { perf } from '../debug/perf';
import type { Match } from './match';
import type { Navigate } from './screens/types';
import type { StressScenario } from '../../sim/stress';
import type { CommandInput } from '../../sim/types';

/** Creates the (unloaded) art manifest. Injected so tests need no WebGL. */
export type ManifestFactory = () => Promise<TeamAssetManifest>;

const defaultManifestFactory: ManifestFactory = async () => {
  const { createProceduralManifest } = await import('../art/procedural');
  return createProceduralManifest({ registry });
};

export class AppHost {
  screen: ScreenName = 'menu';
  match: Match | null = null;
  /** The loaded art manifest, shared by the menus and every match. */
  manifest: TeamAssetManifest | null = null;
  private manifestPromise: Promise<TeamAssetManifest> | null = null;
  private readonly progressListeners = new Set<(fraction: number) => void>();
  /** Set by the `App` router so debug tools can start matches. */
  navigate: Navigate | null = null;
  /** The stress scenario started through the debug hook, if any. */
  stress: StressScenario | null = null;

  constructor(
    readonly platform: Platform,
    private readonly manifestFactory: ManifestFactory = defaultManifestFactory,
  ) {}

  /** Generate the art once (menus show icons, matches draw sprites); later calls reuse it. */
  loadManifest(onProgress?: (fraction: number) => void): Promise<TeamAssetManifest> {
    if (onProgress !== undefined) this.progressListeners.add(onProgress);
    if (this.manifestPromise === null) performance.mark('rts.art.start');
    this.manifestPromise ??= this.manifestFactory().then(async (m) => {
      await m.load((f) => {
        for (const l of this.progressListeners) l(f);
      });
      this.manifest = m;
      performance.measure('rts.art', 'rts.art.start');
      return m;
    });
    const done = this.manifestPromise;
    if (onProgress !== undefined) {
      const detach = (): void => void this.progressListeners.delete(onProgress);
      done.then(detach, detach);
    }
    return done;
  }

  /** Icon URL for the DOM HUD; empty until the manifest is loaded. */
  iconUrl = (id: string): string => this.manifest?.iconUrl(id) ?? '';

  setMatch(match: Match | null): void {
    this.match = match;
    // Dev/e2e stress match: a scripted player issues commands on every tick, like a human would.
    const scenario = this.stress;
    if (match !== null && scenario !== null && scenario.sim === match.sim) {
      match.beforeTick = (tick) => {
        for (const c of scenario.commands(tick)) {
          const { playerId: _playerId, seq: _seq, ...input } = c;
          match.commands.issue(input as CommandInput);
        }
      };
    }
  }

  /** The running match; throws if none. */
  requireMatch(): Match {
    if (this.match === null) throw new Error('No match is running');
    return this.match;
  }

  /** Build the `window.__game` hook object backed by this host. */
  createDebugHook(): GameDebugHook {
    return createDebugHook(this);
  }
}

function createDebugHook(host: AppHost): GameDebugHook {
  return {
    get screen() {
      return host.screen;
    },
    get state() {
      return host.match?.sim.state ?? null;
    },
    get selection() {
      return host.match?.selection ?? [];
    },
    get paused() {
      return host.match?.loop.paused ?? false;
    },
    get speed() {
      return host.match?.loop.speed ?? 1;
    },
    worldToScreen(x, y) {
      const match = host.requireMatch();
      const p = match.renderer.worldToCanvas(x, y);
      const rect = match.renderer.canvas.getBoundingClientRect();
      return { x: rect.left + p.x, y: rect.top + p.y };
    },
    step(n) {
      host.requireMatch().stepTicks(n);
    },
    hash() {
      return hashState(host.requireMatch().sim.state);
    },
    inputMode() {
      return host.match?.modes.active?.kind ?? null;
    },
    ghost() {
      const g = host.match?.modes.ghost() ?? null;
      return g === null
        ? null
        : { tx: g.tx, ty: g.ty, size: g.size, ok: g.ok, visible: g.visible, reason: g.reason, tileOk: [...g.tileOk] };
    },
    overlayStats() {
      return { ...host.requireMatch().overlays.stats };
    },
    minimapToPage(x, y) {
      const minimap = host.requireMatch().minimap;
      if (minimap === null) throw new Error('The minimap is not mounted');
      return minimap.worldToPage(x, y);
    },
    setPaused(paused) {
      host.requireMatch().loop.paused = paused;
    },
    setSpeed(speed) {
      host.requireMatch().loop.speed = speed;
    },
    startStress(seed = 1) {
      // Written out (not via DEBUG_HOOKS_ENABLED) so the bundler drops the stress chunk from production builds.
      if (import.meta.env.DEV || import.meta.env.MODE === 'e2e') {
        if (host.navigate === null) throw new Error('The app is not mounted');
        void import('../../sim/stress').then(({ createStressScenario }) => {
          const scenario = createStressScenario(seed);
          host.stress = scenario;
          host.navigate?.({ name: 'loading', source: { kind: 'sim', sim: scenario.sim } });
        });
      }
    },
    setZoom(zoom) {
      const { camera, canvas } = host.requireMatch().renderer;
      camera.zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, zoom);
    },
    perf: {
      enable(on) {
        perf.enabled = on;
      },
      reset: () => perf.reset(),
      snapshot: () => perf.snapshot(),
    },
    cheat: {
      addResources(amounts) {
        host.requireMatch().commands.issue({ type: 'cheat', cheat: { kind: 'addResources', amounts } });
      },
      instantBuild(enabled) {
        host.requireMatch().commands.issue({ type: 'cheat', cheat: { kind: 'instantBuild', enabled } });
      },
      instantResearch(enabled) {
        host.requireMatch().commands.issue({ type: 'cheat', cheat: { kind: 'instantResearch', enabled } });
      },
    },
  };
}
