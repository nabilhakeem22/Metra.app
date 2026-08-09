import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'vitest/config';

const dir = fileURLToPath(new URL('.', import.meta.url));

// Load root .env so DATABASE_URL is available to the test.
loadEnv({ path: resolve(dir, '../../.env') });

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
