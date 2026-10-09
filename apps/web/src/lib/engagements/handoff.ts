// Design-Engagement Machine — the staff-recorded design-only handoff
// acknowledgement. This is a PLAIN data-entry action (the manual-model stand-in
// for the client's own `acknowledge_handoff` token action), NOT a machine
// transition: it moves no state and touches no trigger — the
// `handoffAcknowledged` guard on `recipientAcknowledges` reads the event it
// writes. Mirrors `recordRomAcknowledgementCore` (rom-acknowledgement.ts).
import { designEngagements, engagementEvents, type MetraDb } from '@metra/db';
import { and, eq, inArray } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import {
  MAX_LABEL_CHARS,
  MAX_NOTE_CHARS,
  TOO_LONG,
  optionalText,
} from '@/lib/validation/text';
import { isValidOccurredOn, liveEvents } from './event-provenance';
import { mayRecordHandoverConfirmation } from './handover-recorders';
import { isTerminal } from './states';

export interface RecordHandoffAcknowledgementInput {
  engagementId: string;
  note?: string | null;
  /**
   * The date the RECIPIENT actually confirmed receipt, when that is not today.
   * `decided_at` only records when the studio typed it.
   */
  occurredOn?: string | null;
  /** HOW they confirmed: a call, a message, a signature on paper. */
  evidence?: string | null;
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
 *
 * OWNER, ADMIN OR PROJECT MANAGER ONLY (owner decision, Oct 9): recording it
 * closes the delivery irreversibly, so any other role is refused `forbidden`
 * before anything is read (handover-recorders.ts).
 *
 * ONE CONFIRMATION, HOWEVER MANY RECORD IT (Round C): the delivery row is locked
 * FOR UPDATE before the check, so two members recording at the same moment
 * serialise, and a live acknowledgement already on file (recorded by a colleague
 * or given by the client) is answered as it is, with no second row.
 */
export async function recordHandoffAcknowledgementCore(
  ctx: OrgContext,
  input: RecordHandoffAcknowledgementInput,
): Promise<ActionResult & { data?: string }> {
  if (!mayRecordHandoverConfirmation(ctx.role)) return err('forbidden');
  const note = optionalText(input.note, MAX_NOTE_CHARS);
  const evidence = optionalText(input.evidence, MAX_NOTE_CHARS);
  // Same provenance rule as the ROM acknowledgement, validated before the
  // transaction opens: a future date is a typo or a fabrication.
  const occurredOn = optionalText(input.occurredOn, MAX_LABEL_CHARS);
  // An over-long field is a REFUSAL, not a truncation: silently storing the
  // first 2000 characters of what the studio typed would lose the rest of an
  // evidentiary note without telling anyone.
  if (note === TOO_LONG || evidence === TOO_LONG || occurredOn === TOO_LONG) {
    return err('invalid');
  }
  if (
    occurredOn !== null &&
    !isValidOccurredOn(occurredOn, new Date().toISOString().slice(0, 10))
  ) {
    return err('invalid');
  }

  return mutateInOrg(
    ctx,
    { capability: 'engagements_design', action: 'create', flow: 'interior' },
    async (tx, audit) => {
      const [engagement] = await tx
        .select({ id: designEngagements.id, state: designEngagements.state })
        .from(designEngagements)
        .where(eq(designEngagements.id, input.engagementId))
        .limit(1)
        .for('update');
      if (!engagement) fail('engagement_not_found');
      // No acknowledging a handoff on a finished engagement (abandoned / closed).
      if (isTerminal(engagement.state)) fail('engagement_not_active');
      // The handoff must actually be open — any earlier (or the execution) stage
      // has no issued design-only package to receive.
      if (engagement.state !== 'design_only_handoff') fail('handoff_not_open');
      const onFile = await liveHandoffAcknowledgementId(tx, input.engagementId);
      if (onFile) return onFile;

      const [row] = await tx
        .insert(engagementEvents)
        .values({
          orgId: ctx.orgId,
          engagementId: input.engagementId,
          kind: 'handoff_acknowledgement',
          actorUserId: ctx.userId,
          note,
          occurredOn,
          evidence,
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

/** The live (not retracted) handover acknowledgement on file, from any channel, or null. */
async function liveHandoffAcknowledgementId(tx: MetraDb, engagementId: string): Promise<string | null> {
  const rows = await tx
    .select({ id: engagementEvents.id, kind: engagementEvents.kind, supersedesEventId: engagementEvents.supersedesEventId })
    .from(engagementEvents)
    .where(
      and(
        eq(engagementEvents.engagementId, engagementId),
        inArray(engagementEvents.kind, ['handoff_acknowledgement', 'event_correction']),
      ),
    );
  return liveEvents(rows).find((row) => row.kind === 'handoff_acknowledgement')?.id ?? null;
}
