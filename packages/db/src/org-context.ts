import { sql } from 'drizzle-orm';
import type { MertaDb } from './client';
import type { MemberRole } from './schema/enums';

export interface OrgContext {
  orgId: string;
  userId: string;
  role: MemberRole;
}

/**
 * The ONLY sanctioned way to touch business tables. Opens a transaction, switches
 * the identity to `merta_app` (NOBYPASSRLS) and sets the request-scoped GUCs that
 * the RLS policies read. `SET LOCAL` scopes everything to this transaction, which
 * is why the :6543 transaction pooler is safe here.
 *
 * `fn` receives the same transaction handle — every query inside runs under RLS.
 */
export async function withOrgContext<T>(
  db: MertaDb,
  ctx: OrgContext,
  fn: (tx: MertaDb) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    // GUCs first, then drop into the non-bypass role for the rest of the tx.
    await tx.execute(
      sql`select set_config('app.current_org_id', ${ctx.orgId}, true)`,
    );
    await tx.execute(
      sql`select set_config('app.current_user_id', ${ctx.userId}, true)`,
    );
    await tx.execute(sql`set local role merta_app`);
    return fn(tx as unknown as MertaDb);
  });
}

/**
 * User-scoped transaction WITHOUT an org context, used only to resolve which
 * org(s) a user belongs to before an org context exists (e.g. requireOrg).
 * Sets `app.current_user_id` and switches to `merta_app`; the `self_memberships`
 * RLS policy exposes only the caller's own membership rows.
 */
export async function withUserContext<T>(
  db: MertaDb,
  userId: string,
  fn: (tx: MertaDb) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.current_user_id', ${userId}, true)`,
    );
    await tx.execute(sql`set local role merta_app`);
    return fn(tx as unknown as MertaDb);
  });
}
