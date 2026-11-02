import 'server-only';
import { proposalEvents, proposals, type MetraDb } from '@metra/db';
import { and, eq, lt, sql } from 'drizzle-orm';

/** Sent proposals whose expiry date is strictly before today (due to expire). */
export function dueForExpiry(
  tx: MetraDb,
  today: string,
): Promise<Array<{ id: string }>> {
  return tx
    .select({ id: proposals.id })
    .from(proposals)
    .where(
      and(
        eq(proposals.status, 'sent'),
        sql`${proposals.expiryDate} is not null`,
        lt(proposals.expiryDate, today),
      ),
    );
}

export interface NudgeCandidate {
  id: string;
  number: number;
  expiryDate: string | null;
  senderUserId: string | null;
}

/** Sent proposals expiring exactly on `targetDate` (today + lead) — pre-nudge. */
export function dueForExpiryNudge(
  tx: MetraDb,
  targetDate: string,
): Promise<NudgeCandidate[]> {
  return tx
    .select({
      id: proposals.id,
      number: proposals.number,
      expiryDate: proposals.expiryDate,
      senderUserId: proposalEvents.actorUserId,
    })
    .from(proposals)
    .innerJoin(
      proposalEvents,
      and(
        eq(proposalEvents.proposalId, proposals.id),
        eq(proposalEvents.kind, 'sent'),
      ),
    )
    .where(
      and(eq(proposals.status, 'sent'), eq(proposals.expiryDate, targetDate)),
    );
}

export interface FollowupCandidate {
  id: string;
  number: number;
  titleEn: string | null;
  titleAr: string | null;
  senderUserId: string | null;
  sentAt: Date;
}

/** Sent (not-yet-accepted) proposals + their sender + send timestamp. */
export function dueForFollowup(tx: MetraDb): Promise<FollowupCandidate[]> {
  return tx
    .select({
      id: proposals.id,
      number: proposals.number,
      titleEn: proposals.titleEn,
      titleAr: proposals.titleAr,
      senderUserId: proposalEvents.actorUserId,
      sentAt: proposalEvents.createdAt,
    })
    .from(proposals)
    .innerJoin(
      proposalEvents,
      and(
        eq(proposalEvents.proposalId, proposals.id),
        eq(proposalEvents.kind, 'sent'),
      ),
    )
    .where(eq(proposals.status, 'sent'));
}
