import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'vitest/config';
import { assertLocalDatabase } from '../../packages/db/src/testing/local-database-guard';

// Action-core DB tests: exercise the PURE cores against the seeded test DB with a
// fabricated OrgContext — no Next layer. `server-only` is stubbed and `@/` maps
// to src so the cores (which import server-only deps) load in plain vitest.
const dir = fileURLToPath(new URL('.', import.meta.url)); // apps/web

loadEnv({ path: resolve(dir, '../../.env') });

// THE SHARED-DATABASE GUARD, run at config load — before a single connection is
// opened. The .env above is the developer's HOSTED Supabase string, so without
// this the obvious pre-push command seeded and deleted organisations in the
// shared database. CI exports DATABASE_URL pointing at its own container and
// dotenv does not override an already-set variable, so CI passes unchanged.
assertLocalDatabase({
  command: 'npm run test:actions -w @metra/web',
  damage: 'creates and deletes whole organisations',
});

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
