// The timeouts every schema-changing script sets on its own connection, and the
// read-back that proves they stuck (migrate, apply-rls, purge-fixture-orgs).
import type { PostgresJs } from '../client';

/**
 * ONE bound, with the millisecond value Postgres actually stores beside the text
 * used to set it. BOTH ARE NEEDED, and the reason is the trap this pair exists to
 * avoid: `current_setting` REFORMATS a GUC, so `set_config(…, '60s')` reads back
 * as `'1min'`. A read-back that compared the formatted text would throw on a value
 * that stuck perfectly. `pg_settings.setting` is always the base unit
 * (milliseconds here) as a plain number, so the check compares that.
 */
interface Timeout {
  name: 'lock_timeout' | 'statement_timeout';
  text: string;
  ms: number;
}

/**
 * How long a schema-changing connection will WAIT for a table lock. Such a script
 * runs its DDL inside a transaction (the drizzle migrator uses ONE for all pending
 * migrations; `sql.unsafe` on the simple protocol makes each `rls/*.sql` file one
 * implicit transaction), and every lock the DDL takes (ACCESS EXCLUSIVE) is held
 * until that transaction commits. The role's default is 0 — wait forever — so a
 * single open reader on a table being altered makes the DDL queue behind it, and
 * because a pending ACCESS EXCLUSIVE request blocks every later lock request on
 * that table, the app's own queries then queue behind the script: one idle
 * transaction stalls the whole table. 3 s makes a blocked run fail fast and loudly
 * (SQLSTATE 55P03) so it can simply be retried in a quiet window.
 *
 * THIS IS NOT THE APP'S 5 s. `org-context.ts:47` sets `lock_timeout = 5s` on the
 * REQUEST connection — a different connection answering a different question. See
 * docs/DEPLOY.md.
 */
const LOCK_TIMEOUT: Timeout = { name: 'lock_timeout', text: '3s', ms: 3_000 };

/**
 * How long ONE `apply-rls` statement may run before 57014. `lock_timeout` bounds
 * each lock WAIT and nothing else: after a successful connect, a stalled socket
 * makes `sql.unsafe` wait forever, because postgres.js has no query-level deadline
 * and no TCP keepalive is configured here — a half-open Supavisor connection turns
 * into an operator staring at `Applying policies/10-…` with no error. 60 s is
 * generous for catalogue-only DDL (the whole 15-file apply measures 1 s in CI) and
 * turns any unforeseen scan into a clean, named failure.
 */
const RLS_STATEMENT_TIMEOUT: Timeout = { name: 'statement_timeout', text: '60s', ms: 60_000 };

/**
 * The same deadline for `db:migrate`, at DOUBLE the value, and the difference is
 * the point: apply-rls only ever creates catalogue objects, while a migration may
 * SCAN. 0052 alone runs twelve `VALIDATE CONSTRAINT`s and 0053 ten index builds —
 * milliseconds at today's volume, but the class of work is no longer bounded by
 * the catalogue, so the deadline has to leave room for a real scan before it calls
 * a live migration dead. It bounds each STATEMENT, not the batch: the migrator
 * runs every pending file in one transaction, so a run of ten statements may
 * legitimately take longer than this while no single one does.
 *
 * WHY IT IS NEEDED AT ALL, given `lock_timeout`. That one bounds lock ACQUISITION.
 * Once 0052's first `DROP CONSTRAINT` HOLDS its ACCESS EXCLUSIVE lock, nothing
 * else bounded the rest of the run: a stalled VALIDATE, a stalled index build or a
 * half-open pooler socket hung the migrator indefinitely with ~fifteen relations
 * locked — which blocks SELECT too, so the engagement core would be down for the
 * whole hang, with no error anywhere (wave 7 R2).
 */
const MIGRATION_STATEMENT_TIMEOUT: Timeout = {
  name: 'statement_timeout',
  text: '120s',
  ms: 120_000,
};

/** Exported for postgres.js's `connection` startup parameter, which Supavisor
 * may discard — which is exactly why the read-back below exists. */
export const MIGRATION_LOCK_TIMEOUT = LOCK_TIMEOUT.text;

/**
 * Set the named timeouts on the session and PROVE they stuck before any DDL
 * runs. The startup-parameter route alone is not enough: Supabase's session
 * pooler (Supavisor) discards the client's startup parameters — measured,
 * `current_setting('lock_timeout')` still reported 0 with postgres.js's
 * `connection` option, and even application_name came back as 'Supavisor'. A
 * session-level `set_config` does stick, and these scripts open the pool with
 * `max: 1`, so this is the very connection the DDL will run on. The read-back is
 * the point: an unverified belt that silently did nothing is worse than none.
 */
async function applyTimeouts(sql: PostgresJs, timeouts: readonly Timeout[]): Promise<void> {
  for (const timeout of timeouts) {
    await sql`select set_config(${timeout.name}, ${timeout.text}, false)`;
  }
  const names = timeouts.map((timeout) => timeout.name);
  const rows = (await sql`
    select name, setting from pg_settings where name = any(${names}::text[])
  `) as unknown as Array<{ name: string; setting: string }>;
  const applied = new Map(rows.map((row) => [row.name, Number(row.setting)]));
  for (const timeout of timeouts) {
    const value = applied.get(timeout.name);
    if (value !== timeout.ms) {
      throw new Error(
        `${timeout.name} is ${value === undefined ? 'unreadable' : `${value}ms`} after ` +
          `set_config, expected ${timeout.ms}ms (${timeout.text}) — refusing to run DDL unbounded.`,
      );
    }
  }
  console.log(
    `${timeouts.map((timeout) => `${timeout.name} = ${timeout.text}`).join(', ')} ` +
      '(read back from pg_settings on this session)',
  );
}

/** `lock_timeout` only — the fixture purge, which runs DELETEs and no DDL. */
export async function applyLockTimeout(sql: PostgresJs): Promise<void> {
  await applyTimeouts(sql, [LOCK_TIMEOUT]);
}

/** Both, for `db:migrate` — 120 s per statement, because migrations may scan. */
export async function applyMigrationTimeouts(sql: PostgresJs): Promise<void> {
  await applyTimeouts(sql, [LOCK_TIMEOUT, MIGRATION_STATEMENT_TIMEOUT]);
}

/**
 * `lock_timeout` AND `statement_timeout` — `apply-rls`, which runs fifteen files
 * as fifteen separate implicit transactions and has no other deadline.
 */
export async function applyRlsTimeouts(sql: PostgresJs): Promise<void> {
  await applyTimeouts(sql, [LOCK_TIMEOUT, RLS_STATEMENT_TIMEOUT]);
}
