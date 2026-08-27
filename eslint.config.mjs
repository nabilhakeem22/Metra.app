// Root ESLint flat config (ESLint v9).
// Includes the Metra house rules:
//   • `metra/no-physical-inline-direction` — bans physical left/right in Tailwind
//     class names and inline style objects. Use CSS logical properties instead
//     (margin-inline-start, text-align: start, ms-*, etc).
//   • `metra/no-bare-tenant-db` — bans Drizzle queries on the raw request/base DB
//     connection (RLS-bypass / cross-tenant leak). Reach org-scoped data only via
//     withOrgContext()/withUserContext(); sanctioned base-connection uses are
//     allowlisted inside the rule module.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import { noPhysicalInlineDirection } from './eslint-rules/no-physical-inline-direction.mjs';
import { noBareTenantDb } from './eslint-rules/no-bare-tenant-db.mjs';

const metraPlugin = {
  rules: {
    'no-physical-inline-direction': noPhysicalInlineDirection,
    'no-bare-tenant-db': noBareTenantDb,
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
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
