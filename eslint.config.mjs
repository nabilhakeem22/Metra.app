// Root ESLint flat config (ESLint v9).
// Includes the Merta house rule `merta/no-physical-inline-direction` which bans
// physical left/right in Tailwind class names and inline style objects. Use CSS
// logical properties instead (margin-inline-start, text-align: start, ms-*, etc).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import { noPhysicalInlineDirection } from './eslint-rules/no-physical-inline-direction.mjs';

const mertaPlugin = {
  rules: { 'no-physical-inline-direction': noPhysicalInlineDirection },
};

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/migrations/**',
      '**/*.config.*',
      'packages/db/src/rls/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js,jsx,mjs}'],
    plugins: { merta: mertaPlugin },
    rules: {
      'merta/no-physical-inline-direction': 'error',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
