/**
 * Windowing behind an interface so a desktop wrapper can replace it (plan 8).
 */

export interface PlatformWindow {
  setTitle(title: string): void;
  isFullscreen(): boolean;
  setFullscreen(on: boolean): Promise<void>;
  /** Whether `quit` does anything on this platform (false in a browser tab). */
  readonly canQuit: boolean;
  quit(): void;
  /** Current viewport size in CSS pixels. */
  size(): { width: number; height: number };
  /** Subscribe to viewport resizes; returns an unsubscribe function. */
  onResize(listener: (width: number, height: number) => void): () => void;
}

export class BrowserPlatformWindow implements PlatformWindow {
  readonly canQuit = false;

  setTitle(title: string): void {
    document.title = title;
  }

  isFullscreen(): boolean {
    return document.fullscreenElement !== null;
  }

  async setFullscreen(on: boolean): Promise<void> {
    if (on && document.fullscreenElement === null) {
      await document.documentElement.requestFullscreen();
    } else if (!on && document.fullscreenElement !== null) {
      await document.exitFullscreen();
    }
  }

  quit(): void {
    // A browser tab cannot close itself reliably; the app returns to the menu instead.
  }

  size(): { width: number; height: number } {
    return { width: window.innerWidth, height: window.innerHeight };
  }

  onResize(listener: (width: number, height: number) => void): () => void {
    const handler = (): void => listener(window.innerWidth, window.innerHeight);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }
}
