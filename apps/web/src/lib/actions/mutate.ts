import type { MetraDb } from '@metra/db';
import { eq } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { recordAudit, type AuditEntry } from '@/lib/audit';
import { DbWriteUncertainError } from '@/lib/db/client';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import {
  canUseFlow,
  loadWorkspaceEntitlements,
} from '@/lib/entitlements/entitlements';
import type { Flow } from '@/lib/entitlements/flows';
import { can } from '@/lib/permissions/can';
import type { Capability, PermissionAction } from '@/lib/permissions/roles';
import { isAmbiguousDbOutcome } from './db-failure';
import { ActionError, type ActionCode, type ActionResult } from './result';

import { fail } from './result';

export { ActionError, fail } from './result';

/**
 * The sanctioned mutation wrapper. Optionally gates on a §2.2 capability BEFORE
 * opening a tx, then runs `fn` inside withOrgContext with an `audit` helper. When
 * `opts.flow` is set, the workspace's entitlements are checked INSIDE the tx
 * (before `fn`) and the mutation is refused with `flow_not_enabled` if the plan
 * doesn't turn that guided flow on. ActionError -> its coded failure; anything
 * else -> logged + 'generic'.
 */
export async function mutateInOrg<T = void>(
  ctx: OrgContext,
  opts: { capability?: Capability; action?: PermissionAction; flow?: Flow },
  fn: (tx: MetraDb, audit: (e: AuditEntry) => Promise<void>) => Promise<T>,
): Promise<ActionResult & { data?: T }> {
  if (
    opts.capability &&
    !can(ctx.role, opts.capability, opts.action ?? 'update')
  ) {
    return { ok: false, error: 'forbidden' };
  }

  try {
    const data = await withOrgContext(
      ctx,
      async (tx) => {
        if (
          opts.flow &&
          !canUseFlow(await loadWorkspaceEntitlements(tx, ctx.orgId), opts.flow)
        ) {
          throw new ActionError('flow_not_enabled');
        }
        return fn(tx, (e) => recordAudit(tx, e));
      },
      { write: true },
    );
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: mutationFailureCode(e) };
  }
}

/**
 * The code a caught mutation failure answers with.
 *
 * Two families are AMBIGUOUS rather than failed, and both must surface as
 * `uncertain` so the cockpit HOLDS the attempt's idempotency key instead of
 * retrying under a fresh one: a write deadline (the abandoned tx may still
 * COMMIT — see DbWriteUncertainError) and a lock timeout / cancelled statement /
 * dropped connection (see isAmbiguousDbOutcome — the attempt being retried may
 * be the very thing holding that lock, and it is still free to commit). Neither
 * is logged as an error: they are expected slow-origin paths, not defects.
 */
function mutationFailureCode(e: unknown): ActionCode {
  if (e instanceof ActionError) return e.code;
  if (e instanceof DbWriteUncertainError || isAmbiguousDbOutcome(e)) {
    return 'uncertain';
  }
  console.error('mutateInOrg failed:', e);
  return 'generic';
}

/**
 * The single row `id` names in THIS org, or a coded failure.
 *
 * THE SHAPE THIS REPLACES, written out thirty-six times:
 *
 * ```ts
 * const [row] = await tx.select({ ... }).from(table)
 *   .where(eq(table.id, id)).limit(1);
 * if (!row) fail('engagement_not_found');
 * ```
 *
 * It looks like boilerplate and it is not. The `where` clause carries NO org
 * predicate on purpose: the RLS transaction is the tenancy boundary, and a row
 * belonging to another org is simply invisible to this SELECT. That means the
 * `if (!row)` line is the ONLY thing standing between a forged id from another
 * tenant and a coded "not found" — and it is also what stops the caller reading
 * `row.state` off `undefined` and turning a refusal into a 500. Thirty-six
 * hand-written copies of a check with that job is thirty-six chances to omit it.
 *
 * `columns` is the caller's own select shape, so the return type is exactly what
 * it asked for, with each column's nullability preserved: a `notNull` column
 * comes back as `T`, everything else as `T | null`. No `!` at the call site, and
 * selecting a column you did not ask for is a compile error rather than an
 * `undefined` at runtime.
 *
 * DELIBERATELY NOT FOR:
 *  - `.for('update')` — a row lock is a concurrency decision that must stay
 *    visible at the site that needs it, and hiding it behind a helper is how one
 *    quietly gets dropped;
 *  - extra predicates (a status gate, a parent id) — those belong in the
 *    caller's own query, where a reader can see what is being asserted;
 *  - a runtime-chosen table (activities' polymorphic entity lookup) — the type
 *    parameter cannot follow a value, and forcing it to would erase exactly the
 *    checking this exists to provide.
 */
export async function requireInOrg<TColumns extends Record<string, PgColumn>>(
  tx: MetraDb,
  table: PgTable & { id: PgColumn },
  id: string,
  columns: TColumns,
  code: ActionCode,
): Promise<SelectedRow<TColumns>> {
  // The cast is where the generic lands: drizzle types a dynamic select shape as
  // a union that includes `any[]`, so TS cannot destructure it on its own. The
  // shape is still checked — SelectedRow is derived from the caller's `columns`.
  const rows = (await tx
    .select(columns)
    .from(table)
    .where(eq(table.id, id))
    .limit(1)) as SelectedRow<TColumns>[];
  const row = rows[0];
  if (!row) fail(code);
  return row;
}

/** The caller's select shape, with each column's nullability carried through. */
type SelectedRow<TColumns extends Record<string, PgColumn>> = {
  [K in keyof TColumns]: TColumns[K]['_']['notNull'] extends true
    ? TColumns[K]['_']['data']
    : TColumns[K]['_']['data'] | null;
};
