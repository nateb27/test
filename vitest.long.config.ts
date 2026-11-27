/**
 * `npm run test:long`: the long-running sim tests (`tests/sim/**\/*.long.test.ts`), excluded from `npm test`.
 * Run by the phase gates and nightly CI (PLAN-M2 8.1).
 */

import { defineConfig } from 'vitest/config';
import base from './vite.config';

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    // Replaces (not extends) the normal include/exclude lists.
    include: ['tests/sim/**/*.long.test.{ts,tsx}'],
    exclude: ['**/node_modules/**'],
    testTimeout: 1_800_000,
  },
});
