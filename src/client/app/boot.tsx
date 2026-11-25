import { render } from 'preact';
import { installDebugHook } from '../debug/hook';
import { createBrowserPlatform } from '../platform';
import { App } from './App';
import { AppHost } from './host';

/** Mount the app into `root`. */
export function boot(root: HTMLElement): void {
  const host = new AppHost(createBrowserPlatform());
  host.platform.window.setTitle('Untitled RTS');
  installDebugHook(host.createDebugHook());
  render(<App host={host} />, root);
}
