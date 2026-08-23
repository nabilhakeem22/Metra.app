// Design-Engagement Machine — the append-only engagement approvals ledger.
//
// Step 7: `recordConceptApproval`, the `selectConcept` side-effect. Executor-only:
// MUST be called with the executor's `tx` so the approval-event insert commits
// ATOMICALLY with the concept_review -> negotiation state move, or not at all. No
// payment is collected here — the Gate-A receipt was recorded into the payment
// ledger beforehand and the `gateAInstallmentCleared` guard verifies it cleared;
// this side-effect only appends the row that witnesses the concept selection.
//
// Step 12: `recordRomAcknowledgementCore`, a STANDALONE data-entry action (not a
// transition) that appends the client's acknowledgement of the firm's ROM band,
// snapshotting the current ROM into the event so the acknowledged range is frozen.
import { designEngagements, engagementEvents, type MetraDb } from '@metra/db';
import { eq } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import type { ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { isTerminal } from './states';

/**
 * Append ONE `concept_approval` row to the append-only engagement approvals ledger
 * for `engagementId`. `decidedAt` defaults to now() at the database; `actorUserId`
 * is the internal actor from the request context.
 */
export async function recordConceptApproval(
  tx: MetraDb,
  ctx: OrgContext,
  engagementId: string,
): Promise<void> {
  await tx.insert(engagementEvents).values({
    orgId: ctx.orgId,
    engagementId,
    kind: 'concept_approval',
    actorUserId: ctx.userId,
  });
}

/**
 * Append ONE `design_approval` row to the append-only engagement approvals ledger
 * for `engagementId` — the `approveDesign` side-effect (Step 14). Executor-only:
 * MUST be called with the executor's `tx` so this witness commits ATOMICALLY with
 * the final_approval -> shop_drawings state move, or not at all. `decidedAt`
 * defaults to now() at the database; `actorUserId` is the internal actor.
 */
export async function recordDesignApproval(
  tx: MetraDb,
  ctx: OrgContext,
  engagementId: string,
): Promise<void> {
  await tx.insert(engagementEvents).values({
    orgId: ctx.orgId,
    engagementId,
    kind: 'design_approval',
    actorUserId: ctx.userId,
  });
}

/** Trim a nullable free-text field to a stored value ('' / whitespace -> null). */
function optionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export interface RecordRomAcknowledgementInput {
  engagementId: string;
  note?: string | null;
}

/**
 * Design-Engagement Machine, Step 12 — record the client's acknowledgement of the
 * firm's ROM band as an append-only event. This is a STANDALONE data-entry action
 * (the manual-model client ack), NOT a machine transition: it moves no state and
 * touches no trigger — Gate B's later guard reads this event. Gated on the
 * `engagements_design` capability (create). Flow: open the RLS tx; assert the
 * engagement resolves in-org (`engagement_not_found` if absent/foreign) and is NOT
 * terminal (`engagement_not_active`); require BOTH `rom_low` and `rom_high` are set
 * (else `rom_not_set` — you can't acknowledge a range never entered); append ONE
 * `rom_acknowledgement` row that SNAPSHOTS the engagement's current ROM into the
 * event's `range_low`/`range_high` columns, so the acknowledged band is frozen at
 * ack time even if ROM is later edited. Returns the new event id. Never throws to
 * the client — coded ActionResult only.
 */
export async function recordRomAcknowledgementCore(
  ctx: OrgContext,
  input: RecordRomAcknowledgementInput,
): Promise<ActionResult & { data?: string }> {
  const note = optionalText(input.note);

  return mutateInOrg(
    ctx,
    { capability: 'engagements_design', action: 'create' },
    async (tx, audit) => {
      const [engagement] = await tx
        .select({
          id: designEngagements.id,
          state: designEngagements.state,
          romLow: designEngagements.romLow,
          romHigh: designEngagements.romHigh,
        })
        .from(designEngagements)
        .where(eq(designEngagements.id, input.engagementId))
        .limit(1);
      if (!engagement) fail('engagement_not_found');
      // No acknowledging a range on a finished engagement (abandoned / closed).
      if (isTerminal(engagement.state)) fail('engagement_not_active');
      // Can't acknowledge a range that was never entered (Step 10's setEngagementRom).
      if (engagement.romLow === null || engagement.romHigh === null) {
        fail('rom_not_set');
      }

      // Snapshot the CURRENT canonical ROM into the event so the acknowledged band
      // is frozen at ack time — a later ROM edit must not rewrite this witness.
      const [row] = await tx
        .insert(engagementEvents)
        .values({
          orgId: ctx.orgId,
          engagementId: input.engagementId,
          kind: 'rom_acknowledgement',
          actorUserId: ctx.userId,
          rangeLow: engagement.romLow,
          rangeHigh: engagement.romHigh,
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
          kind: 'rom_acknowledgement',
          range_low: engagement.romLow,
          range_high: engagement.romHigh,
        },
      });
      return row.id;
    },
  );
}
