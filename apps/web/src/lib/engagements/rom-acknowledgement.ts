// Design-Engagement Machine, Step 12: `recordRomAcknowledgementCore`, a
// STANDALONE data-entry action (not a transition) that appends the client's
// acknowledgement of the firm's ROM band to the append-only engagement ledger,
// snapshotting the current ROM into the event so the acknowledged range is frozen.
import { fieldsFailed } from '@/lib/actions/field-errors';
import { mutateInOrg } from '@/lib/actions/mutate';
import type { ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { readAcknowledgementFields } from './acknowledgement-field-rules';
import { appendRomAcknowledgementEvent, requireAcknowledgeableRom } from './rom-acknowledgement-ledger';

export interface RecordRomAcknowledgementInput {
  engagementId: string;
  note?: string | null;
  /**
   * The date the CLIENT actually confirmed, when that is not today. `decided_at`
   * only ever records when the studio typed it, and a record dated "today" for a
   * call last Thursday is the weakest possible evidence. Omitted means the two
   * coincide.
   */
  occurredOn?: string | null;
  /** HOW they confirmed: a phone call, a WhatsApp message, a signature on paper. */
  evidence?: string | null;
}

/**
 * Design-Engagement Machine, Step 12 — record the client's acknowledgement of the
 * firm's ROM band as an append-only event. This is a STANDALONE data-entry action
 * (the manual-model client ack), NOT a machine transition: it moves no state and
 * touches no trigger — Gate B's later guard reads this event. Gated on the
 * `engagements_design` capability (create). Flow: open the RLS tx; assert the
 * engagement resolves in-org (`engagement_not_found` if absent/foreign) and is NOT
 * terminal (`engagement_not_active`); require BOTH `rom_low` and `rom_high` are set
 * (else `rom_not_set` — you can't acknowledge a range never entered) and that the
 * band was ISSUED to the client (else `rom_not_issued` — a band the client never
 * saw cannot have been acknowledged, and Gate B reads this event as consent); append ONE
 * `rom_acknowledgement` row that SNAPSHOTS the engagement's current ROM into the
 * event's `range_low`/`range_high` columns, so the acknowledged band is frozen at
 * ack time even if ROM is later edited. Returns the new event id. Never throws to
 * the client — coded ActionResult only.
 */
export async function recordRomAcknowledgementCore(
  ctx: OrgContext,
  input: RecordRomAcknowledgementInput,
): Promise<ActionResult & { data?: string }> {
  // Provenance, validated before the transaction opens, every refusal under its
  // field. `toISOString` gives today in UTC, the calendar day the date input
  // offered.
  const typed = readAcknowledgementFields(input, new Date().toISOString().slice(0, 10));
  if (!typed.ok) return fieldsFailed(typed.errors);
  const { note, occurredOn, evidence } = typed.values;

  return mutateInOrg(
    ctx,
    { capability: 'engagements_design', action: 'create', flow: 'interior' },
    async (tx, audit) => {
      const engagement = await requireAcknowledgeableRom(tx, input.engagementId);
      const acknowledgement = { engagementId: input.engagementId, engagement, note, occurredOn, evidence };
      return appendRomAcknowledgementEvent(tx, ctx, acknowledgement, audit);
    },
  );
}
