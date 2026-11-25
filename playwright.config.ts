import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 4173);
// Per-port output folders so two suites can run side by side (build output, results, screenshots).
const SUFFIX = PORT === 4173 ? '' : `-${PORT}`;
const DIST = `dist-e2e${SUFFIX}`;

// Use a pre-installed Chromium when present (sandboxed dev containers);
// CI installs Playwright's own browser instead.
const LOCAL_CHROMIUM = '/opt/pw-browsers/chromium';
const executablePath = !process.env.CI && existsSync(LOCAL_CHROMIUM) ? LOCAL_CHROMIUM : undefined;

export default defineConfig({
  testDir: 'tests/e2e',
  // Matches are real (software GL) and some scenarios play several minutes of game time (stepped, not waited for).
  // Every wait in the suite is a condition (state polled, frames counted, the sim stepped), never a delay, so these
  // limits only bound a hang. They are generous because the renderer is software GL: a suite sharing a loaded machine
  // with another one needs several times the time of a quiet run for the same deterministic work.
  timeout: 150_000,
  expect: { timeout: 15_000 },
  outputDir: `test-results${SUFFIX}`,
  // Tests are independent (own page, own pinned map seed, own saves) so they run in parallel; the software-GL renderer
  // is CPU bound, so two workers per suite keep a second suite on the same machine usable. E2E_WORKERS overrides.
  fullyParallel: true,
  workers: Number(process.env.E2E_WORKERS ?? 2),
  forbidOnly: !!process.env.CI,
  retries: 0, // a flaky test is a bug to fix, never to retry
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
    command: `npx vite build --mode e2e --outDir ${DIST} && npx vite preview --outDir ${DIST} --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
