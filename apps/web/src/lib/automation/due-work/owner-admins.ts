import 'server-only';
import { memberships, type MetraDb } from '@metra/db';
import { inArray } from 'drizzle-orm';

/** Owner + admin user ids in the current org (digest + stage recipients). */
export function orgOwnerAdminIds(tx: MetraDb): Promise<Array<{ userId: string }>> {
  return tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(inArray(memberships.role, ['owner', 'admin']));
}
