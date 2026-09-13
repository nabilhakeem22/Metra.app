// Applies Drizzle migrations to the DB over the session pooler (:5432).
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from '../client';
import { MIGRATION_DATABASE_URL } from '../env';

const here = dirname(fileURLToPath(import.meta.url)); // packages/db/src/scripts
const migrationsFolder = resolve(here, '../../migrations');

/**
 * Why the migrate connection caps how long it will WAIT for a lock: the drizzle
 * migrator runs ALL pending migrations inside ONE transaction, and every table
 * lock an ALTER takes (ACCESS EXCLUSIVE) is held until that transaction commits.
 * The role's default `lock_timeout` is 0 — wait forever — so a single open
 * reader on a table being altered makes the ALTER queue behind it, and because a
 * pending ACCESS EXCLUSIVE request blocks every later lock request on that
 * table, the app's own queries then queue behind the migration: one idle
 * transaction stalls the whole table. 3 s makes a blocked migrate fail fast and
 * loudly (SQLSTATE 55P03) so it can simply be retried in a quiet window,
 * instead of taking production down while it waits.
 */
const MIGRATION_LOCK_TIMEOUT = '3s';

async function main() {
  const { db, sql } = createDb(MIGRATION_DATABASE_URL(), {
    max: 1,
    prepare: true,
    connection: { lock_timeout: MIGRATION_LOCK_TIMEOUT },
  });
  try {
    // Belt for the pooled path: Supabase's session pooler (Supavisor) discards
    // the client's startup parameters — measured, `current_setting('lock_timeout')`
    // still reported 0 with the option above, and even application_name came back
    // as 'Supavisor'. A session-level SET does stick, and `max: 1` means this is
    // the very connection the migration transaction will run on.
    await sql`select set_config('lock_timeout', ${MIGRATION_LOCK_TIMEOUT}, false)`;
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
