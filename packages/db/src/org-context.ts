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
): Promise<void> {
  await tx.execute(sql`select ${identity},
    set_config('lock_timeout', '5s', true),
    set_config('statement_timeout', '20s', true),
    set_config('idle_in_transaction_session_timeout', '30s', true),
    set_config('role', 'metra_app', true)`);
}

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
): Promise<T> {
  return db.transaction(async (tx) => {
    await openBoundTransaction(
      tx,
      sql`set_config('app.current_org_id', ${ctx.orgId}, true),
    set_config('app.current_user_id', ${ctx.userId}, true),
    set_config('app.current_user_email', ${ctx.email ?? ''}, true)`,
    );
    return fn(tx as unknown as MetraDb);
  });
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
