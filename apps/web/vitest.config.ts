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
  // apps/web/tsconfig.json sets "jsx": "preserve" because Next requires it.
  // esbuild honours that and emits the CLASSIC React.createElement, so a .test.tsx
  // dies with `ReferenceError: React is not defined`. The unit runner is not Next,
  // so it gets the automatic runtime instead. Measured, not assumed.
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
  test: {
    // src only. The database suites live under tests/actions and run from
    // vitest.actions.config.ts against a real Postgres. The two include sets are
    // disjoint by construction: this one is src/**, that one is tests/actions/**,
    // so no *.dbtest.ts can ever be collected by the component runner.
    include: [
      resolve(dir, 'src/**/*.test.ts').replace(/\\/g, '/'),
      resolve(dir, 'src/**/*.test.tsx').replace(/\\/g, '/'),
    ],
    // Node stays the default so the existing node files run byte-identically.
    // Only a .tsx file — i.e. only a file that renders — pays for a DOM. That is
    // also the naming rule for this suite: a test that touches `document` is
    // named .test.tsx, whether or not it contains JSX.
    environment: 'node',
    environmentMatchGlobs: [['**/*.test.tsx', 'happy-dom']],
  },
});
