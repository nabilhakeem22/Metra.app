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

/** Revokes every live key `memberId` created in this org, one audit row each. Caller's transaction. */
export async function revokeKeysCreatedBy(
  tx: MetraDb,
  audit: (entry: AuditEntry) => Promise<void>,
  memberId: string,
): Promise<void> {
  const now = new Date();
  const revoked = await tx
    .update(apiKeys)
    .set({ revokedAt: now, updatedAt: now })
    .where(and(eq(apiKeys.createdBy, memberId), isNull(apiKeys.revokedAt)))
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
