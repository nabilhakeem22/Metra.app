// Design-Engagement Machine — the staff-recorded design-only handoff
// acknowledgement. This is a PLAIN data-entry action (the manual-model stand-in
// for the client's own `acknowledge_handoff` token action), NOT a machine
// transition: it moves no state and touches no trigger — the
// `handoffAcknowledged` guard on `recipientAcknowledges` reads the event it
// writes. Mirrors `recordRomAcknowledgementCore` (approvals.ts).
import { designEngagements, engagementEvents } from '@metra/db';
import { eq } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import type { ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { isTerminal } from './states';

export interface RecordHandoffAcknowledgementInput {
  engagementId: string;
  note?: string | null;
}

/** Trim a nullable free-text field to a stored value ('' / whitespace -> null). */
function optionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Record the recipient's acknowledgement of the design-only handoff as an
 * append-only event, on the client's behalf. Gated on the `engagements_design`
 * capability (create). Flow: open the RLS tx; assert the engagement resolves
 * in-org (`engagement_not_found` if absent/foreign) and is NOT terminal
 * (`engagement_not_active`); require the engagement to actually SIT at
 * `design_only_handoff` (else `handoff_not_open` — there is no handoff to
 * acknowledge before the package is out); append ONE `handoff_acknowledgement`
 * row with the internal actor and the trimmed optional note. Returns the new
 * event id. Never throws to the client — coded ActionResult only.
 */
export async function recordHandoffAcknowledgementCore(
  ctx: OrgContext,
  input: RecordHandoffAcknowledgementInput,
): Promise<ActionResult & { data?: string }> {
  const note = optionalText(input.note);

  return mutateInOrg(
    ctx,
    { capability: 'engagements_design', action: 'create', flow: 'interior' },
    async (tx, audit) => {
      const [engagement] = await tx
        .select({ id: designEngagements.id, state: designEngagements.state })
        .from(designEngagements)
        .where(eq(designEngagements.id, input.engagementId))
        .limit(1);
      if (!engagement) fail('engagement_not_found');
      // No acknowledging a handoff on a finished engagement (abandoned / closed).
      if (isTerminal(engagement.state)) fail('engagement_not_active');
      // The handoff must actually be open — any earlier (or the execution) stage
      // has no issued design-only package to receive.
      if (engagement.state !== 'design_only_handoff') fail('handoff_not_open');

      const [row] = await tx
        .insert(engagementEvents)
        .values({
          orgId: ctx.orgId,
          engagementId: input.engagementId,
          kind: 'handoff_acknowledgement',
          actorUserId: ctx.userId,
          note,
        })
        .returning({ id: engagementEvents.id });

      await audit({
        entity: 'design_engagement',
        entityId: input.engagementId,
        action: 'create',
        before: null,
        after: {
          event_id: row.id,
          kind: 'handoff_acknowledgement',
        },
      });
      return row.id;
    },
  );
}
