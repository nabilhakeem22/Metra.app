import { memberships, type MetraDb } from '@metra/db';
import { eq, sql } from 'drizzle-orm';
import { fail } from '@/lib/actions/result';

/**
 * Serialize owner mutations within an org (advisory xact lock keyed to org_id).
 * Take this BEFORE reading the owner count so two concurrent demotes/removes
 * can't both pass the last-owner guard. Must run inside a withOrgContext tx.
 */
export async function lockOrgMemberships(
  tx: MetraDb,
  orgId: string,
): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${orgId}))`);
}

/** Number of owners visible in the current org context. Used only internally. */
async function ownerCount(tx: MetraDb): Promise<number> {
  const rows = await tx
    .select({ id: memberships.id })
    .from(memberships)
    .where(eq(memberships.role, 'owner'));
  return rows.length;
}

/**
 * The one last-owner invariant: an org must always keep at least one owner.
 * Call after lockOrgMemberships when demoting/removing an owner. Throws
 * ActionError('last_owner') (→ the action returns { ok:false, error:'last_owner' }).
 */
export async function ensureNotLastOwner(tx: MetraDb): Promise<void> {
  if ((await ownerCount(tx)) <= 1) {
    fail('last_owner');
  }
}
