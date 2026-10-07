// The email reminder's per-delivery cooldown (Round B, B11, S2). SERVER-SIDE,
// inside the caller's RLS transaction. Every reminder email leaves an audit
// row (`after.reminder = 'email'`), and one that did not go out leaves a
// second (`'email_failed'`), so the newest of the two says whether the client
// was actually written to recently. No column, no migration: the audit log is
// the record, read through its (org, entity, entity_id, at) index.
import { auditLog, designEngagements, type MetraDb } from '@metra/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import { fail } from '@/lib/actions/result';

/** One email reminder per delivery per this many minutes. */
export const REMINDER_EMAIL_COOLDOWN_MINUTES = 15;

/** The audit `after.reminder` values this rule reads. */
export const REMINDER_EMAIL_REQUESTED = 'email';
export const REMINDER_EMAIL_FAILED = 'email_failed';

/**
 * Refuse `reminder_too_soon` when an email reminder for this delivery was
 * requested within the cooldown and did not fail. The delivery row is locked
 * FIRST, so two clicks (two tabs, a scripted loop) serialise: the second one
 * reads the first one's committed audit row and is refused.
 */
export async function refuseIfRemindedRecently(tx: MetraDb, engagementId: string): Promise<void> {
  await tx
    .select({ id: designEngagements.id })
    .from(designEngagements)
    .where(eq(designEngagements.id, engagementId))
    .for('update');
  const reminder = sql<string | null>`${auditLog.after} ->> 'reminder'`;
  const [latest] = await tx
    .select({
      reminder,
      recent: sql<boolean>`${auditLog.at} > now() - make_interval(mins => ${REMINDER_EMAIL_COOLDOWN_MINUTES})`,
    })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.entity, 'design_engagement'),
        eq(auditLog.entityId, engagementId),
        sql`${reminder} in (${REMINDER_EMAIL_REQUESTED}, ${REMINDER_EMAIL_FAILED})`,
      ),
    )
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(1);
  if (latest?.reminder === REMINDER_EMAIL_REQUESTED && latest.recent) fail('reminder_too_soon');
}
