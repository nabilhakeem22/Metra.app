import type { MetraDb } from '@metra/db';
import { driverErrorOf } from '@metra/db/sqlstate';
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
import { isImmutabilityViolation, isUniqueViolationOf } from './db-conflict';
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
 *
 * `conflict` / `immutableCode` let a mutation NAME the race it can lose. Both
 * are optional and both are per-mutation on purpose: 23505 means "a contract
 * already exists" at contracts/generate and something else entirely at
 * team/invite, so the wrapper cannot know the sentence — only the caller can.
 *
 * `conflict` names the CONSTRAINT as well as the code, because a mutation is
 * several statements and only one of them is the race the caller means. The
 * first version took a bare code and answered it for ANY 23505 in the
 * transaction: `generateContractCore` would have called a collision on the
 * contract NUMBER "a contract already exists", and removed the one log line
 * that recorded it.
 */
export async function mutateInOrg<T = void>(
  ctx: OrgContext,
  opts: {
    capability?: Capability;
    action?: PermissionAction;
    flow?: Flow;
    /**
     * The code a 23505 from ONE NAMED constraint means. Any other 23505 —
     * including one from a different constraint on the same table — stays
     * `generic` and is logged, because it is not the race the caller named.
     */
    conflict?: { constraint: string; code: ActionCode };
    /** The code an MT100 from THIS mutation means (the row locked under us). */
    immutableCode?: ActionCode;
  },
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
    return { ok: false, error: mutationFailureCode(e, opts) };
  }
}

/**
 * The code a caught mutation failure answers with. THE ORDER IS THE CONTRACT.
 *
 * `ActionError` first: a coded refusal the mutation raised itself outranks any
 * SQLSTATE reading.
 *
 * AMBIGUOUS second, and it must stay ahead of the two named conflicts below.
 * Two families are ambiguous rather than failed, and both surface as `uncertain`
 * so the cockpit HOLDS the attempt's idempotency key instead of retrying under a
 * fresh one: a write deadline (the abandoned tx may still COMMIT — see
 * DbWriteUncertainError) and a lock timeout / cancelled statement / dropped
 * connection (see isAmbiguousDbOutcome — the attempt being retried may be the
 * very thing holding that lock, and it is still free to commit). Re-labelling
 * one of those a REFUSAL would tell a caller the write is dead when it is not.
 *
 * Then the caller's own names for 23505 and MT100, if it gave any — and the
 * 23505 only when the CONSTRAINT matches too. An unexpected unique violation
 * inside a mutation that named a different one is not a refusal the product has
 * a sentence for; it belongs in the tail, with the log line.
 *
 * A MAPPED CODE IS NOT LOGGED AS AN ERROR, and neither is an ambiguous one:
 * they are expected races the product has a sentence for, and a false defect
 * line in the log is half of what this exists to remove. Only the unclassified
 * tail reaches `console.error` + `generic`, and what it logs is a WHITELIST —
 * see `loggableFailure`, and never the error object itself.
 */
function mutationFailureCode(
  e: unknown,
  opts: {
    conflict?: { constraint: string; code: ActionCode };
    immutableCode?: ActionCode;
  },
): ActionCode {
  if (e instanceof ActionError) return e.code;
  if (e instanceof DbWriteUncertainError || isAmbiguousDbOutcome(e)) {
    return 'uncertain';
  }
  if (opts.conflict && isUniqueViolationOf(e, opts.conflict.constraint)) {
    return opts.conflict.code;
  }
  if (opts.immutableCode && isImmutabilityViolation(e)) return opts.immutableCode;
  console.error('mutateInOrg failed:', loggableFailure(e));
  return 'generic';
}

/**
 * The fields of an unclassified failure that may be written to the log — a
 * WHITELIST, never the error object.
 *
 * postgres.js builds its PostgresError by `Object.assign`-ing every field of the
 * server's ErrorResponse onto the error, and those fields are ENUMERABLE. One of
 * them is `detail`, and for a 23505 `detail` is the row: `Key (org_id, email)=
 * (…, someone@example.com) already exists.` Logging the error object therefore
 * logs whatever the colliding index is built on, and the index a future mutation
 * races is not something this line can know in advance. (`query` and
 * `parameters` are non-enumerable unless postgres.js debug is on, which it is
 * not — but that is a property of somebody else's library, which is the wrong
 * thing to depend on.)
 *
 * Five fields, all of them describing the SHAPE of the failure rather than the
 * row: `name`, `code`, `constraint_name`, `table_name`, `message`. Together they
 * answer "which constraint on which table refused, and with what SQLSTATE",
 * which is the whole diagnostic value of this line. Strings only, so a field
 * carrying a structured value cannot smuggle an object in.
 *
 * ALL FIVE ARE READ OFF ONE OBJECT: `driverErrorOf`, the level in the `cause`
 * chain that the DRIVER threw. From drizzle 0.44 an ORM query's error arrives
 * wrapped in a `DrizzleQueryError` whose `message` is `Failed query: <sql>
 * params: <the bound parameters>` — the row values, by another route. Walking
 * field by field would take `constraint_name` off the driver error and `message`
 * off the wrapper, and log exactly what this whitelist exists to keep out.
 *
 * AND WHEN THERE IS NO DRIVER ERROR, THE WRAPPER IS STILL NOT SAFE TO READ. The
 * fallback used to hand the thrown value straight to the whitelist, which is
 * right for a plain `Error` and wrong for a `DrizzleQueryError` whose cause
 * carries no SQLSTATE — a dropped socket ("Network connection lost."), a driver
 * error whose `code` is undefined, a chain the cycle guard stopped walking. Its
 * `message` IS the bound parameters, so `{ name, message }` put the client's
 * email, phone and name into Workers Logs on the one path nobody had a case
 * for. `isOrmQueryWrapper` recognises it by the two own properties drizzle's
 * constructor always sets, and that branch logs what it IS and nothing it
 * carries.
 */
function loggableFailure(e: unknown): Record<string, string> {
  const driver = driverErrorOf(e);
  if (!driver && isOrmQueryWrapper(e)) {
    const name = (e as { name?: unknown }).name;
    return typeof name === 'string' && name.length > 0
      ? { name, thrown: ORM_QUERY_WRAPPER }
      : { thrown: ORM_QUERY_WRAPPER };
  }
  const source = driver ?? (e as Record<string, unknown> | null | undefined);
  const safe: Record<string, string> = {};
  for (const field of LOGGABLE_ERROR_FIELDS) {
    const value = source?.[field];
    if (typeof value === 'string' && value.length > 0) safe[field] = value;
  }
  // A thrown non-object would otherwise log as `{}`, which reads like a bug in
  // this function rather than a fact about the failure.
  return Object.keys(safe).length > 0 ? safe : { thrown: typeof e };
}

/** What the log says instead of a wrapper's message. */
const ORM_QUERY_WRAPPER = 'DrizzleQueryError';

/**
 * Is this the ORM's query wrapper rather than something worth reading fields off?
 *
 * By its two OWN properties, not by `instanceof` and not by `name`:
 * `DrizzleQueryError`'s constructor sets `query`, `params` and `cause` and never
 * touches `name`, so the thrown object reports itself as a plain 'Error' and an
 * `instanceof` check would bind this file to a deep import of somebody else's
 * package. Own properties only — a driver error that happens to inherit a
 * `query` from a prototype is not this.
 */
function isOrmQueryWrapper(e: unknown): boolean {
  if (e === null || typeof e !== 'object') return false;
  const own = Object.prototype.hasOwnProperty.bind(e);
  return own('query') && own('params');
}

const LOGGABLE_ERROR_FIELDS = [
  'name',
  'code',
  'constraint_name',
  'table_name',
  'message',
] as const;

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
