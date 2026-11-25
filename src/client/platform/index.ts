import { BrowserPlatformWindow, type PlatformWindow } from './platformWindow';
import { LocalSaveStorage, type SaveStorage } from './saveStorage';

export type { PlatformWindow } from './platformWindow';
export type { SaveMeta, SaveStorage } from './saveStorage';
export { BrowserPlatformWindow } from './platformWindow';
export { LocalSaveStorage } from './saveStorage';

/** Platform services the app is given at boot. */
export interface Platform {
  storage: SaveStorage;
  window: PlatformWindow;
}

/** The browser platform used by the web build. */
export function createBrowserPlatform(): Platform {
  return { storage: new LocalSaveStorage(), window: new BrowserPlatformWindow() };
}
