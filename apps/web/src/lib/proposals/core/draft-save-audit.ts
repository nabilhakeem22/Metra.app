import 'server-only';
// The audit trail of draft saves. PROPORTIONATE: an autosaving builder saves
// after every pause, and a row per pause would bury the trail (and the table)
// under hundreds of identical `proposal update` entries an hour.
import { auditLog, type MetraDb } from '@metra/db';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { AuditEntry } from '@/lib/audit';

/** How long one editing stretch shares a single `proposal update` audit row. */
const DRAFT_AUDIT_WINDOW = sql`interval '5 minutes'`;

/**
 * The ledger entry a draft save leaves: how much document, and worth what. An
 * autosaving builder saves after every pause, so one entry stands for an editing
 * stretch: none is written when this draft already has one from the last five
 * minutes. Sending is audited by its own action, as before.
 */
export async function auditDraftSaved(
  tx: MetraDb,
  audit: (entry: AuditEntry) => Promise<void>,
  proposalId: string,
  sectionCount: number,
  total: string,
): Promise<void> {
  const [recent] = await tx
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.entity, 'proposal'),
        eq(auditLog.entityId, proposalId),
        eq(auditLog.action, 'update'),
        gt(auditLog.at, sql`now() - ${DRAFT_AUDIT_WINDOW}`),
      ),
    )
    .limit(1);
  if (recent) return;
  await audit({
    entity: 'proposal',
    entityId: proposalId,
    action: 'update',
    before: null,
    after: { sections: sectionCount, total },
  });
}
