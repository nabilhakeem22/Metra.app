import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'vitest/config';
import { assertLocalDatabase } from './src/testing/local-database-guard';

const dir = fileURLToPath(new URL('.', import.meta.url));

// Load root .env so DATABASE_URL is available to the test.
loadEnv({ path: resolve(dir, '../../.env') });

// THE SHARED-DATABASE GUARD, run at config load — before a single connection is
// opened. This suite creates and DROPS scratch tables in `public`, which must
// never happen anywhere but a throwaway local Postgres. CI exports DATABASE_URL
// pointing at its own container, so CI passes unchanged.
assertLocalDatabase({
  command: 'npm run test:isolation -w @metra/db',
  damage: 'creates and DROPS scratch tables in the public schema',
});

// Vitest globs expect forward slashes even on Windows.
const testsGlob = resolve(dir, '../../tests/isolation/**/*.test.ts').replace(
  /\\/g,
  '/',
);

export default defineConfig({
  test: {
    include: [testsGlob],
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
});
