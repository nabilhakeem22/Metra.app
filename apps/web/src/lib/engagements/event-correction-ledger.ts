// The two phases of retracting a ledger row, inside recordEventCorrectionCore's
// transaction: find the event and check it may be retracted, then append the
// correction that points at it, with its audit row.
import { engagementEvents, type EngagementEventKind, type MetraDb } from '@metra/db';
import { and, eq } from 'drizzle-orm';
import { fail } from '@/lib/actions/mutate';
import type { AuditEntry } from '@/lib/audit';
import type { OrgContext } from '@/lib/db/context';

interface EventCorrectionEntry {
  engagementId: string;
  eventId: string;
  reason: string;
  supersedesKind: EngagementEventKind;
}

/** The event on this engagement that may still be retracted, or the refusal that says why not. */
export async function requireRetractableEvent(
  tx: MetraDb,
  engagementId: string,
  eventId: string,
): Promise<{ id: string; kind: EngagementEventKind }> {
  // Scoped to the PARENT as well as the org: RLS stops a foreign tenant, and
  // this stops a valid id from a sibling engagement being retracted here.
  const [target] = await tx
    .select({
      id: engagementEvents.id,
      kind: engagementEvents.kind,
    })
    .from(engagementEvents)
    .where(
      and(
        eq(engagementEvents.id, eventId),
        eq(engagementEvents.engagementId, engagementId),
      ),
    )
    .limit(1);
  if (!target) fail('event_not_found');
  // A correction is bookkeeping about the ledger, not an event in it. Letting
  // one be retracted would mean un-retracting the row beneath it by a side
  // effect nobody reading the ledger would expect.
  if (target.kind === 'event_correction') fail('malformed');

  // Retracting twice would write a second correction that changes nothing and
  // muddies the record with a decision that was already taken.
  const [existing] = await tx
    .select({ id: engagementEvents.id })
    .from(engagementEvents)
    .where(eq(engagementEvents.supersedesEventId, eventId))
    .limit(1);
  if (existing) fail('already_corrected');
  return target;
}

/** Appends the correction that supersedes the event and audits it; answers the correction's id. */
export async function appendEventCorrection(
  tx: MetraDb,
  ctx: OrgContext,
  correction: EventCorrectionEntry,
  audit: (entry: AuditEntry) => Promise<void>,
): Promise<string> {
  const { engagementId, eventId, reason, supersedesKind } = correction;
  const [row] = await tx
    .insert(engagementEvents)
    .values({
      orgId: ctx.orgId,
      engagementId,
      kind: 'event_correction',
      actorUserId: ctx.userId,
      supersedesEventId: eventId,
      note: reason,
    })
    .returning({ id: engagementEvents.id });

  await audit({
    entity: 'design_engagement',
    entityId: engagementId,
    action: 'update',
    before: null,
    after: {
      event_id: row.id,
      kind: 'event_correction',
      supersedes_event_id: eventId,
      supersedes_kind: supersedesKind,
      reason,
    },
  });
  return row.id;
}
