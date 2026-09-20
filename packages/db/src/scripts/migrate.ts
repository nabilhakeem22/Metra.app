// Applies Drizzle migrations to the DB over the session pooler (:5432).
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from '../client';
import { MIGRATION_DATABASE_URL } from '../env';
import { MIGRATION_LOCK_TIMEOUT, applyMigrationTimeouts } from './lock-timeout';

const here = dirname(fileURLToPath(import.meta.url)); // packages/db/src/scripts
const migrationsFolder = resolve(here, '../../migrations');

async function main() {
  const { db, sql } = createDb(MIGRATION_DATABASE_URL(), {
    max: 1,
    prepare: true,
    connection: { lock_timeout: MIGRATION_LOCK_TIMEOUT },
  });
  try {
    // BOTH bounds, read back from pg_settings before a single statement runs.
    // `lock_timeout` alone bounds lock ACQUISITION; once the first DDL statement
    // HOLDS its ACCESS EXCLUSIVE lock, `statement_timeout` is the only thing
    // standing between a stalled scan or a half-open pooler socket and a
    // migrator that hangs forever with the schema locked (wave 7 R2).
    await applyMigrationTimeouts(sql);
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
