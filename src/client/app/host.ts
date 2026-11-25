/**
 * App-level state outside the Preact tree: platform services, the current
 * screen name and the running match. Backs the `window.__game` hook.
 */

import { registry } from '../../data';
import { hashState } from '../../sim/hash';
import type { TeamAssetManifest } from '../art/procedural';
import type { GameDebugHook, ScreenName } from '../debug/hook';
import type { Platform } from '../platform';
import type { Match } from './match';

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

  constructor(
    readonly platform: Platform,
    private readonly manifestFactory: ManifestFactory = defaultManifestFactory,
  ) {}

  /** Generate the art once (menus show icons, matches draw sprites); later calls reuse it. */
  loadManifest(onProgress?: (fraction: number) => void): Promise<TeamAssetManifest> {
    if (onProgress !== undefined) this.progressListeners.add(onProgress);
    this.manifestPromise ??= this.manifestFactory().then(async (m) => {
      await m.load((f) => {
        for (const l of this.progressListeners) l(f);
      });
      this.manifest = m;
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
    setPaused(paused) {
      host.requireMatch().loop.paused = paused;
    },
    setSpeed(speed) {
      host.requireMatch().loop.speed = speed;
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
