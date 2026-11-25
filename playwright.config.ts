import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 4173);

// Use a pre-installed Chromium when present (sandboxed dev containers);
// CI installs Playwright's own browser instead.
const LOCAL_CHROMIUM = '/opt/pw-browsers/chromium';
const executablePath = !process.env.CI && existsSync(LOCAL_CHROMIUM) ? LOCAL_CHROMIUM : undefined;

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        launchOptions: {
          ...(executablePath ? { executablePath } : {}),
          args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
        },
      },
    },
  ],
  // E2E runs against the built output, built in 'e2e' mode so window.__game exists.
  webServer: {
    command: `npx vite build --mode e2e --outDir dist-e2e && npx vite preview --outDir dist-e2e --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
