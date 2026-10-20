import { sql, type SQL } from 'drizzle-orm';
import type { MetraDb } from './client';
import type { MemberRole } from './schema/enums';

export interface OrgContext {
  orgId: string;
  userId: string;
  role: MemberRole;
  /** Session user's email — used by the bootstrap-membership RLS check. */
  email?: string;
  /**
   * The account that owns the active org (A3). Additive/optional: it does NOT
   * flow into a GUC and `withOrgContext` ignores it — org isolation stays keyed
   * on org_id. Undefined when the org is not yet linked to an account.
   */
  accountId?: string;
}

/**
 * How long a capped transaction may last, in EVERY state: waiting on a lock,
 * running, or idle between statements. `lock_timeout` bounds each lock WAIT,
 * and a writer that needs a row FOR UPDATE while a steady stream of FOR SHARE
 * holders overlap on it re-waits once per holder set, each wait with a fresh
 * 5 s: measured, a contract writer was held 20 s, until `statement_timeout`
 * (A5 reliability R1). `transaction_timeout` (PostgreSQL 17+) ends the
 * transaction AND its session when the cap passes (SQLSTATE 25P04), which the
 * app answers `uncertain`, the answer a lock timeout already gets. Set
 * mid-transaction it starts counting from that moment, which is the opening
 * statement here.
 *
 * On a server older than 17 the setting does not exist, so it is set only
 * when `server_version_num` says it may be, in the same statement (the
 * version check lock-timeout.ts makes, without a second round trip): the CASE
 * never calls set_config on an older server. Production runs 17.
 */
const WHOLE_TRANSACTION_CAP = sql`case when current_setting('server_version_num')::integer >= 170000
      then set_config('transaction_timeout', '8s', true) end`;

/**
 * Open the transaction: identity GUCs, the non-bypass role and the server-side
 * bounds, in ONE round trip.
 *
 * `SET LOCAL` scopes every setting to this transaction, which is why the :6543
 * transaction pooler is safe here; `set_config(name, value, true)` is the
 * function form of the same thing, which is what lets the whole preamble be a
 * single statement instead of six sequential ones — including the role switch,
 * for which `set_config('role', ...)` is the documented equivalent of
 * `SET LOCAL ROLE`.
 *
 * A role's `rolconfig` defaults do not apply to a `SET ROLE` switch, so metra_app
 * inherits the login role's settings: lock_timeout 0 (wait forever) and a
 * statement_timeout measured in minutes. The app's own 15 s write deadline is a
 * `Promise.race` — it abandons the JS promise but NOT the Postgres transaction,
 * which was measured still alive, and still holding its row locks, 10.9 s after
 * the caller had given up. So the server has to bound itself: a writer that
 * cannot take its lock in 5 s fails instead of queueing behind an abandoned one,
 * no statement outlives its request by more than 20 s, and — because only the
 * server can reap a transaction the client has stopped waiting for — an idle
 * abandoned transaction is rolled back after 30 s instead of holding its locks
 * until the socket closes.
 */
async function openBoundTransaction(
  tx: { execute: (query: SQL) => Promise<unknown> },
  identity: SQL,
  capTransaction = false,
): Promise<void> {
  await tx.execute(sql`select ${identity},
    set_config('lock_timeout', '5s', true),
    set_config('statement_timeout', '20s', true),
    set_config('idle_in_transaction_session_timeout', '30s', true),
    ${capTransaction ? sql`${WHOLE_TRANSACTION_CAP},` : sql``}
    set_config('role', 'metra_app', true)`);
}

/**
 * What a transaction is opened as, beyond the bounds every one gets.
 *  - `snapshot`: REPEATABLE READ READ ONLY, so every statement reads ONE
 *    snapshot. For a read that shows several figures of one record together
 *    (the final account card, A5 R2): under READ COMMITTED each statement
 *    takes its own, and a write committing between two of them tears the card.
 *  - `capTransaction`: the whole-transaction cap above, for a writer that
 *    takes a contended row FOR UPDATE.
 */
export interface TransactionOptions {
  snapshot?: boolean;
  capTransaction?: boolean;
}

const SNAPSHOT_READ = { isolationLevel: 'repeatable read', accessMode: 'read only' } as const;

/**
 * The ONLY sanctioned way to touch business tables. Opens a transaction, switches
 * the identity to `metra_app` (NOBYPASSRLS) and sets the request-scoped GUCs that
 * the RLS policies read. `SET LOCAL` scopes everything to this transaction, which
 * is why the :6543 transaction pooler is safe here.
 *
 * `fn` receives the same transaction handle — every query inside runs under RLS.
 */
export async function withOrgContext<T>(
  db: MetraDb,
  ctx: OrgContext,
  fn: (tx: MetraDb) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  return db.transaction(
    async (tx) => {
      await openBoundTransaction(
        tx,
        sql`set_config('app.current_org_id', ${ctx.orgId}, true),
    set_config('app.current_user_id', ${ctx.userId}, true),
    set_config('app.current_user_email', ${ctx.email ?? ''}, true)`,
        options.capTransaction,
      );
      return fn(tx as unknown as MetraDb);
    },
    options.snapshot ? SNAPSHOT_READ : undefined,
  );
}

/**
 * User-scoped transaction WITHOUT an org context, used only to resolve which
 * org(s) a user belongs to before an org context exists (e.g. requireOrg).
 * Sets `app.current_user_id` and switches to `metra_app`. Business tables remain
 * fully RLS-isolated here (no permissive policy); the only sanctioned read is via
 * the SECURITY DEFINER function `public.app_current_user_memberships()`, which is
 * scoped to `app.current_user_id`.
 */
export async function withUserContext<T>(
  db: MetraDb,
  userId: string,
  fn: (tx: MetraDb) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await openBoundTransaction(
      tx,
      sql`set_config('app.current_user_id', ${userId}, true)`,
    );
    return fn(tx as unknown as MetraDb);
  });
}
