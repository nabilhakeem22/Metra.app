import { defineConfig } from 'drizzle-kit';
import { MIGRATION_DATABASE_URL } from './src/env';

// Migrations run over the session pooler (:5432) — see .env DATABASE_URL.
export default defineConfig({
  schema: './src/schema/index.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: MIGRATION_DATABASE_URL(),
  },
  casing: 'snake_case',
  verbose: true,
  strict: true,
});
