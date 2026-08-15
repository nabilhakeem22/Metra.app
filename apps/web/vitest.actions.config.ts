import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'vitest/config';

// Action-core DB tests: exercise the PURE cores against the seeded test DB with a
// fabricated OrgContext — no Next layer. `server-only` is stubbed and `@/` maps
// to src so the cores (which import server-only deps) load in plain vitest.
const dir = fileURLToPath(new URL('.', import.meta.url)); // apps/web

loadEnv({ path: resolve(dir, '../../.env') });

export default defineConfig({
  resolve: {
    alias: {
      'server-only': resolve(dir, 'tests/actions/server-only-stub.ts'),
      '@': resolve(dir, 'src'),
    },
  },
  test: {
    include: [resolve(dir, 'tests/actions/**/*.dbtest.ts').replace(/\\/g, '/')],
    testTimeout: 60000,
    hookTimeout: 60000,
    fileParallelism: false,
  },
});
