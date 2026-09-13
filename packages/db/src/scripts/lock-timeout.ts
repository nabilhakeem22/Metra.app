// The lock bound shared by every schema-changing script (migrate, apply-rls).
import type { PostgresJs } from '../client';

/**
 * Why a schema-changing connection caps how long it will WAIT for a table lock:
 * such a script runs its DDL inside a transaction (the drizzle migrator uses ONE
 * for all pending migrations; `sql.unsafe` on the simple protocol makes each
 * `rls/*.sql` file one implicit transaction), and every lock the DDL takes
 * (ACCESS EXCLUSIVE) is held until that transaction commits. The role's default
 * `lock_timeout` is 0 — wait forever — so a single open reader on a table being
 * altered makes the DDL queue behind it, and because a pending ACCESS EXCLUSIVE
 * request blocks every later lock request on that table, the app's own queries
 * then queue behind the script: one idle transaction stalls the whole table.
 * 3 s makes a blocked run fail fast and loudly (SQLSTATE 55P03) so it can simply
 * be retried in a quiet window, instead of taking production down while it waits.
 */
export const MIGRATION_LOCK_TIMEOUT = '3s';

/**
 * Sets `lock_timeout` on the session and PROVES it stuck before any DDL runs.
 * The startup-parameter route alone is not enough: Supabase's session pooler
 * (Supavisor) discards the client's startup parameters — measured,
 * `current_setting('lock_timeout')` still reported 0 with postgres.js's
 * `connection` option, and even application_name came back as 'Supavisor'. A
 * session-level `set_config` does stick, and these scripts open the pool with
 * `max: 1`, so this is the very connection the DDL will run on. The read-back is
 * the point: an unverified belt that silently did nothing is worse than none.
 */
export async function applyLockTimeout(sql: PostgresJs): Promise<void> {
  await sql`select set_config('lock_timeout', ${MIGRATION_LOCK_TIMEOUT}, false)`;
  const [row] = await sql<
    { lockTimeout: string }[]
  >`select current_setting('lock_timeout') as "lockTimeout"`;
  if (row?.lockTimeout !== MIGRATION_LOCK_TIMEOUT) {
    throw new Error(
      `lock_timeout is "${row?.lockTimeout ?? 'unreadable'}" after set_config, ` +
        `expected "${MIGRATION_LOCK_TIMEOUT}" — refusing to run DDL unbounded.`,
    );
  }
  console.log(`lock_timeout = ${row.lockTimeout} (verified on this session)`);
}
