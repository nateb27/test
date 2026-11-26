import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import preact from '@preact/preset-vite';
import { defineConfig } from 'vitest/config';

/** Hash of the rendered-art sources: part of the IndexedDB cache key, so any change to the art re-renders it. */
function artSourceHash(): string {
  const h = createHash('sha1');
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.ts')) h.update(name).update(readFileSync(p));
    }
  };
  for (const d of ['src/client/art/rendered']) walk(d);
  for (const f of ['src/client/art/catalog.ts', 'src/client/art/manifest.ts']) h.update(readFileSync(f));
  return h.digest('hex').slice(0, 12);
}

export default defineConfig({
  // Relative asset paths so the static build can be wrapped as a desktop app.
  base: './',
  plugins: [preact()],
  define: {
    __ART_HASH__: JSON.stringify(artSourceHash()),
  },
  worker: {
    format: 'es',
  },
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
