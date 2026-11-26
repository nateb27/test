import { options, render } from 'preact';
import { installArtHook } from '../debug/artHook';
import { DEBUG_HOOKS_ENABLED, installDebugHook } from '../debug/hook';
import { perf } from '../debug/perf';
import { createBrowserPlatform } from '../platform';
import { App } from './App';
import { gameHooks } from './hooks';
import { AppHost } from './host';

/** Mount the app into `root`. */
export function boot(root: HTMLElement): void {
  const host = new AppHost(createBrowserPlatform());
  host.platform.window.setTitle('Untitled RTS');
  installDebugHook(host.createDebugHook());
  installArtHook(host);
  if (DEBUG_HOOKS_ENABLED) {
    // Dev/e2e only: time Preact's batched component re-renders (the HUD) for `__game.perf`.
    options.debounceRendering = (flush) => {
      void Promise.resolve().then(() => {
        const t0 = perf.start();
        flush();
        perf.end('hud.preact', t0);
      });
    };
  }
  render(<App host={host} hooks={gameHooks} />, root);
  // Draw the art in the background so menu icons are ready; the loading screen waits for it if not.
  host.loadManifest().catch((err: unknown) => console.error('Art generation failed', err));
}
