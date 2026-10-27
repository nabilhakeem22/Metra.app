import 'server-only';
import { auditLog, proposalEvents, type MetraDb } from '@metra/db';
import { and, eq, gt, or, sql } from 'drizzle-orm';
import { REMINDER_EMAIL_REQUESTED } from '@/lib/engagements/reminder/audit-values';

// How many emails a studio has caused since a moment, counted from rows the
// actions ALREADY write (no counter table, no migration). Read on the caller's
// withOrgContext transaction (./daily-caps.ts takes the cap's lock first), so a
// count only ever sees the caller's own studio. The
// (org_id, entity, ...) index prefix bounds each audit scan to one studio.

const COUNT = sql<number>`count(*)::int`;

/** audit_log: entity='invitation' AND (action='create' OR (action='update' AND after->>'resent'='true')) AND at > since. */
export async function countTeamInviteEmailsSince(tx: MetraDb, since: Date): Promise<number> {
  const [row] = await tx
    .select({ count: COUNT })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.entity, 'invitation'),
        gt(auditLog.at, since),
        or(eq(auditLog.action, 'create'), and(eq(auditLog.action, 'update'), sql`${auditLog.after} ->> 'resent' = 'true'`)),
      ),
    );
  return row?.count ?? 0;
}

/** proposal_events kind='sent' AND created_at > since, PLUS audit_log entity='design_engagement' AND action='issue'
 *  AND after->>'reminder' = REMINDER_EMAIL_REQUESTED AND at > since. */
export async function countClientEmailsSince(tx: MetraDb, since: Date): Promise<number> {
  const [proposals] = await tx
    .select({ count: COUNT })
    .from(proposalEvents)
    .where(and(eq(proposalEvents.kind, 'sent'), gt(proposalEvents.createdAt, since)));
  const [reminders] = await tx
    .select({ count: COUNT })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.entity, 'design_engagement'),
        eq(auditLog.action, 'issue'),
        sql`${auditLog.after} ->> 'reminder' = ${REMINDER_EMAIL_REQUESTED}`,
        gt(auditLog.at, since),
      ),
    );
  return (proposals?.count ?? 0) + (reminders?.count ?? 0);
}
