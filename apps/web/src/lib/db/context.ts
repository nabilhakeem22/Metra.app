import 'server-only';
import {
  withOrgContext as coreWithOrgContext,
  withUserContext as coreWithUserContext,
  type MertaDb,
  type OrgContext,
} from '@merta/db';
import { getDb } from './client';

export type { OrgContext };

/**
 * THE sanctioned data entrypoint. Opens an RLS-enforced, org-scoped transaction.
 * Never query business tables outside this.
 */
export function withOrgContext<T>(
  ctx: OrgContext,
  fn: (tx: MertaDb) => Promise<T>,
): Promise<T> {
  return coreWithOrgContext(getDb(), ctx, fn);
}

/** User-scoped (no org) — only for resolving a user's org in requireOrg. */
export function withUserContext<T>(
  userId: string,
  fn: (tx: MertaDb) => Promise<T>,
): Promise<T> {
  return coreWithUserContext(getDb(), userId, fn);
}
