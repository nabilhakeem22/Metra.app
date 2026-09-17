// Root ESLint flat config (ESLint v9).
// Includes the Metra house rules:
//   • `metra/no-physical-inline-direction` — bans physical left/right in Tailwind
//     class names and inline style objects. Use CSS logical properties instead
//     (margin-inline-start, text-align: start, ms-*, etc).
//   • `metra/no-bare-tenant-db` — bans Drizzle queries on the raw request/base DB
//   • `metra/no-server-registry-in-client` — bans value-importing a server registry
//     barrel from a 'use client' module (this caused a production outage once)
//     connection (RLS-bypass / cross-tenant leak). Reach org-scoped data only via
//     withOrgContext()/withUserContext(); sanctioned base-connection uses are
//     allowlisted inside the rule module.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import { noPhysicalInlineDirection } from './eslint-rules/no-physical-inline-direction.mjs';
import { noBareTenantDb } from './eslint-rules/no-bare-tenant-db.mjs';
import { noServerRegistryInClient } from './eslint-rules/no-server-registry-in-client.mjs';

const metraPlugin = {
  rules: {
    'no-physical-inline-direction': noPhysicalInlineDirection,
    'no-bare-tenant-db': noBareTenantDb,
    'no-server-registry-in-client': noServerRegistryInClient,
  },
};

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/next-env.d.ts',
      '**/dist/**',
      '**/migrations/**',
      '**/*.config.*',
      '**/.claude/**',
      'packages/db/src/rls/**',
      // Cloudflare/OpenNext generated artifacts (gitignored build output +
      // wrangler-generated env types) — never lint these.
      '**/.open-next/**',
      '**/.wrangler/**',
      '**/cloudflare-env.d.ts',
      '**/worker-configuration.d.ts',
      // No-op CommonJS/ESM stub package (stands in for prettier to keep it out
      // of the Worker bundle) — not app source, and its .cjs files use CommonJS
      // globals eslint's browser/ESM env doesn't define.
      'stubs/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js,jsx,mjs}'],
    plugins: { metra: metraPlugin },
    rules: {
      'metra/no-physical-inline-direction': 'error',
      'metra/no-bare-tenant-db': 'error',
      'metra/no-server-registry-in-client': 'error',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      // TEST-ONLY HELPERS STAY OUT OF THE PRODUCT BUNDLE. apps/web/src/test/*
      // imports vitest at module scope, and it sits INSIDE src — resolved by the
      // `@` alias, covered by tsconfig — so a product file importing it would
      // typecheck and lint clean and then fail the OpenNext build at DEPLOY, on
      // a devDependency that cannot resolve in the Worker bundle. This is a
      // boundary the repo otherwise enforces hard, so it fails closed here too.
      // Test files are exempted below; they are who the helpers are for.
      //
      // BOTH SPELLINGS ARE BANNED. `no-restricted-imports` matches the SPECIFIER
      // STRING, not the file it resolves to, so the alias group alone left
      // `../test/doubles` — the form somebody working inside src/lib writes by
      // accident — completely invisible. The three helpers are named because a
      // bare `**/test/*` would also catch unrelated directories called `test`.
      //
      // WHAT IS STILL NOT COVERED: a DYNAMIC import, in EITHER spelling —
      // `await import('@/test/doubles')` and `await import('../test/doubles')`
      // are both clean. This core rule visits import DECLARATIONS only, so a
      // dynamic import reaches the same module unreported whichever specifier
      // it uses. Covering it needs an `ImportExpression` visitor, which means a
      // rule of our own — `metra/no-server-registry-in-client` is not it: that
      // rule is about barrels inside 'use client' modules and has no such
      // visitor to extend. Deliberately left: the static forms are what anybody
      // actually writes, and a `no-restricted-imports` that silently half-covers
      // a boundary is worse than one whose gap is written down.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/test',
                '@/test/*',
                '**/test/render-with-intl*',
                '**/test/doubles*',
                '**/test/documents-tab-contract*',
              ],
              message:
                'apps/web/src/test/* is TEST-ONLY (it imports vitest at module scope). ' +
                'A product module must not import it: the OpenNext Worker bundle cannot ' +
                'resolve a devDependency, and that failure would surface at deploy.',
            },
          ],
        },
      ],
    },
  },
  {
    // The test files themselves — the helpers exist for exactly these.
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.dbtest.ts', '**/src/test/**'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    // Node CLI scripts: plain ESM run by `node`, so they legitimately use the
    // Node globals eslint's default (browser/ESM) environment does not define.
    // The .ts scripts don't need this — typescript-eslint turns `no-undef` off
    // for TypeScript, where tsc is already the authority on what exists.
    files: ['**/scripts/**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly' },
    },
  },
);
