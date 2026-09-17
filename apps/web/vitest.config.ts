import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit suite (`npm test -w @metra/web`): the PURE leaves and the mocked readers
// under src/. Previously this ran with NO config at all, which meant `@/` did not
// resolve — a module was only unit-testable if every one of its `@/` imports
// happened to be mocked. That is a footgun rather than a discipline: it made
// extracting a shared leaf (`@/lib/uuid`) break three unrelated suites that had
// nothing to do with the change.
//
// So: the `@` alias, and nothing else. `server-only` is deliberately NOT stubbed
// here (unlike vitest.actions.config.ts) — a module that reaches for a server-only
// dependency should still fail loudly in a unit test unless the test explicitly
// mocks it, which is what keeps the client-safe leaves honest.
const dir = fileURLToPath(new URL('.', import.meta.url)); // apps/web

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(dir, 'src'),
    },
  },
  test: {
    // src, PLUS the plain `*.test.ts` under tests/actions. The database suites
    // there are `*.dbtest.ts`, matched by neither pattern here and run from
    // vitest.actions.config.ts against a real Postgres — so this still opens no
    // connection and needs no DATABASE_URL. It is what lets the test
    // INFRASTRUCTURE that lives beside them (step-summary) be unit tested at
    // all; before, a helper in that folder could only be exercised by running
    // the whole database suite.
    include: [
      resolve(dir, 'src/**/*.test.ts').replace(/\\/g, '/'),
      resolve(dir, 'tests/actions/**/*.test.ts').replace(/\\/g, '/'),
    ],
  },
});
