// What a studio closes on the Public API side when a member is removed: the
// keys that member minted. A key resolves through its creator's LIVE membership
// (rls/functions/20-api-keys.sql), so removal alone only makes it dormant: a
// later re-invite, under any role, would bring it back to life with nobody
// having approved it again. Stamping `revoked_at` ends it for good.
//
// PURE (no next/*, no server-only): lib/team/core imports it.
import { apiKeys, type MetraDb } from '@metra/db';
import { and, eq, isNull } from 'drizzle-orm';
import type { AuditEntry } from '@/lib/audit';

/**
 * Revokes every live key `memberId` created in `orgId`, one audit row each.
 * Caller's transaction.
 *
 * The org is in the statement itself, not left to row-level security alone: a
 * member can belong to several studios and mint keys in each, and removing him
 * from one must never reach the others, whatever connection this runs on.
 */
export async function revokeKeysCreatedBy(
  tx: MetraDb,
  audit: (entry: AuditEntry) => Promise<void>,
  creator: { orgId: string; memberId: string },
): Promise<void> {
  const now = new Date();
  const revoked = await tx
    .update(apiKeys)
    .set({ revokedAt: now, updatedAt: now })
    .where(and(eq(apiKeys.orgId, creator.orgId), eq(apiKeys.createdBy, creator.memberId), isNull(apiKeys.revokedAt)))
    .returning({ id: apiKeys.id });

  for (const key of revoked) {
    await audit({
      entity: 'api_key',
      entityId: key.id,
      action: 'update',
      before: null,
      after: { revoked: true, via: 'member_removed' },
    });
  }
}
