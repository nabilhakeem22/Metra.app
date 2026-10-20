import 'server-only';
import {
  withOrgContext as coreWithOrgContext,
  withUserContext as coreWithUserContext,
  type MetraDb,
  type OrgContext,
  type TransactionOptions,
} from '@metra/db';
import { withRequestDb } from './client';

export type { OrgContext };

/**
 * THE sanctioned data entrypoint. Opens an RLS-enforced, org-scoped transaction
 * on a request-scoped connection (fresh per request on the Cloudflare runtime,
 * the process singleton off-platform). Never query business tables outside this.
 *
 * `opts.write` marks the operation as a mutation so a Cloudflare deadline surfaces
 * as an *uncertain* outcome (the abandoned tx may still COMMIT) rather than a
 * clean failure. Reads leave it unset — a timed-out SELECT commits nothing.
 * mutateInOrg is the only caller that passes it; direct read callers stay unchanged.
 *
 * `opts.snapshot` and `opts.capTransaction` are how the transaction is opened
 * (`TransactionOptions`, packages/db org-context.ts): one snapshot for a read
 * that shows several figures together, a whole-transaction cap for a writer
 * of a contended row.
 */
export function withOrgContext<T>(
  ctx: OrgContext,
  fn: (tx: MetraDb) => Promise<T>,
  opts: { write?: boolean } & TransactionOptions = {},
): Promise<T> {
  const { write, ...transaction } = opts;
  return withRequestDb((db) => coreWithOrgContext(db, ctx, fn, transaction), { write });
}

/** User-scoped (no org) — only for resolving a user's org in requireOrg. */
export function withUserContext<T>(
  userId: string,
  fn: (tx: MetraDb) => Promise<T>,
): Promise<T> {
  return withRequestDb((db) => coreWithUserContext(db, userId, fn));
}
