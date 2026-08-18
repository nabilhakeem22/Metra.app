import 'server-only';
import {
  withOrgContext as coreWithOrgContext,
  withUserContext as coreWithUserContext,
  type MetraDb,
  type OrgContext,
} from '@metra/db';
import { withRequestDb } from './client';

export type { OrgContext };

/**
 * THE sanctioned data entrypoint. Opens an RLS-enforced, org-scoped transaction
 * on a request-scoped connection (fresh per request on the Cloudflare runtime,
 * the process singleton off-platform). Never query business tables outside this.
 */
export function withOrgContext<T>(
  ctx: OrgContext,
  fn: (tx: MetraDb) => Promise<T>,
): Promise<T> {
  return withRequestDb((db) => coreWithOrgContext(db, ctx, fn));
}

/** User-scoped (no org) — only for resolving a user's org in requireOrg. */
export function withUserContext<T>(
  userId: string,
  fn: (tx: MetraDb) => Promise<T>,
): Promise<T> {
  return withRequestDb((db) => coreWithUserContext(db, userId, fn));
}
