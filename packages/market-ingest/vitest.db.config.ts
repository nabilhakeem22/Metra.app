import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'vitest/config';
import { assertLocalDatabase } from '../db/src/testing/local-database-guard';

// The market CLI against a real (LOCAL) database: history checks, catalogue,
// publish and withdraw. They write the platform-level market tables, so the
// shared-database guard runs at config load, before any connection opens.
const dir = fileURLToPath(new URL('.', import.meta.url)); // packages/market-ingest

loadEnv({ path: resolve(dir, '../../.env') });

assertLocalDatabase({
  command: 'npm run test:db -w @metra/market-ingest',
  damage: 'publishes and deletes market bulletins and items',
});

export default defineConfig({
  test: {
    include: [resolve(dir, 'tests/**/*.dbtest.ts').replace(/\\/g, '/')],
    testTimeout: 60000,
    hookTimeout: 60000,
    fileParallelism: false,
  },
});
