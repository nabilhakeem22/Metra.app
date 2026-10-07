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
 * The ledger entry a draft save leaves: how much document, and worth what, as
 * THIS save stored it. An autosaving builder saves after every pause, so one
 * entry stands for an editing stretch of one person: none is written when this
 * ACTOR already has one on this draft from the last five minutes (a colleague's
 * edits are never hidden behind yours). Sending is audited by its own action.
 */
export async function auditDraftSaved(
  tx: MetraDb,
  audit: (entry: AuditEntry) => Promise<void>,
  saved: { proposalId: string; actorUserId: string; sectionCount: number; lineCount: number; total: string },
): Promise<void> {
  const { proposalId, actorUserId, sectionCount, lineCount, total } = saved;
  const [recent] = await tx
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.entity, 'proposal'),
        eq(auditLog.entityId, proposalId),
        eq(auditLog.action, 'update'),
        eq(auditLog.actorUserId, actorUserId),
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
    after: { sections: sectionCount, lines: lineCount, total },
  });
}
