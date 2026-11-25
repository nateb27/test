import preact from '@preact/preset-vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths so the static build can be wrapped as a desktop app.
  base: './',
  plugins: [preact()],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    include: ['tests/unit/**/*.test.{ts,tsx}', 'tests/sim/**/*.test.{ts,tsx}'],
    environment: 'node',
    // Heavy sim tests (determinism, bot pacing, long runs) must not depend on machine load: generous limits.
    testTimeout: 180_000,
    hookTimeout: 120_000,
  },
});
