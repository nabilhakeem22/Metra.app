// Applies Drizzle migrations to the DB over the session pooler (:5432).
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from '../client';
import { MIGRATION_DATABASE_URL } from '../env';

const here = dirname(fileURLToPath(import.meta.url)); // packages/db/src/scripts
const migrationsFolder = resolve(here, '../../migrations');

async function main() {
  const { db, sql } = createDb(MIGRATION_DATABASE_URL(), {
    max: 1,
    prepare: true,
  });
  try {
    console.log(`Applying migrations from ${migrationsFolder} ...`);
    await migrate(db, { migrationsFolder });
    console.log('Migrations applied.');
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
