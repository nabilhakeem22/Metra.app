import 'server-only';
import {
  engagementEvents,
  engagementTransitions,
  type DesignEngagementState,
  type EngagementEventKind,
} from '@metra/db';
import { desc, eq } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';

/** One row of the append-only transition ledger (state moves), newest first. */
export interface EngagementTransitionRecord {
  id: string;
  trigger: string | null;
  fromState: DesignEngagementState | null;
  toState: DesignEngagementState | null;
  actorUserId: string | null;
  note: string | null;
  decidedAt: Date;
}

/**
 * The lifecycle transition ledger for an engagement, NEWEST FIRST. RLS scopes the
 * read to the caller's org (a foreign engagement reads as an empty list). Feeds
 * the detail timeline alongside the approvals events.
 */
export function getEngagementTransitions(
  ctx: OrgContext,
  engagementId: string,
): Promise<EngagementTransitionRecord[]> {
  return withOrgContext(ctx, (tx) =>
    tx
      .select({
        id: engagementTransitions.id,
        trigger: engagementTransitions.trigger,
        fromState: engagementTransitions.fromState,
        toState: engagementTransitions.toState,
        actorUserId: engagementTransitions.actorUserId,
        note: engagementTransitions.note,
        decidedAt: engagementTransitions.decidedAt,
      })
      .from(engagementTransitions)
      .where(eq(engagementTransitions.engagementId, engagementId))
      .orderBy(
        desc(engagementTransitions.decidedAt),
        desc(engagementTransitions.createdAt),
      ),
  );
}

/** One recorded decision in the append-only engagement approvals ledger. */
export interface EngagementEventRecord {
  id: string;
  kind: EngagementEventKind;
  actorUserId: string | null;
  docHash: string | null;
  note: string | null;
  decidedAt: Date;
}

/**
 * The approvals-ledger events recorded against an engagement, NEWEST FIRST
 * (includes `rom_acknowledgement` rows). RLS scopes the read to the caller's org
 * (a foreign engagement reads as an empty list). Omits the tokenized-client-ack
 * columns (actor_name/ip/user_agent) and the `range_low/high` ROM snapshot — a
 * range-aware read can select those when a surface needs them.
 */
export function getEngagementEvents(
  ctx: OrgContext,
  engagementId: string,
): Promise<EngagementEventRecord[]> {
  return withOrgContext(ctx, (tx) =>
    tx
      .select({
        id: engagementEvents.id,
        kind: engagementEvents.kind,
        actorUserId: engagementEvents.actorUserId,
        docHash: engagementEvents.docHash,
        note: engagementEvents.note,
        decidedAt: engagementEvents.decidedAt,
      })
      .from(engagementEvents)
      .where(eq(engagementEvents.engagementId, engagementId))
      .orderBy(
        desc(engagementEvents.decidedAt),
        desc(engagementEvents.createdAt),
      ),
  );
}
