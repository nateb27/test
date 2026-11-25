import { render } from 'preact';
import { installDebugHook } from '../debug/hook';
import { createBrowserPlatform } from '../platform';
import { App } from './App';
import { gameHooks } from './hooks';
import { AppHost } from './host';

/** Mount the app into `root`. */
export function boot(root: HTMLElement): void {
  const host = new AppHost(createBrowserPlatform());
  host.platform.window.setTitle('Untitled RTS');
  installDebugHook(host.createDebugHook());
  render(<App host={host} hooks={gameHooks} />, root);
  // Draw the art in the background so menu icons are ready; the loading screen waits for it if not.
  host.loadManifest().catch((err: unknown) => console.error('Art generation failed', err));
}
