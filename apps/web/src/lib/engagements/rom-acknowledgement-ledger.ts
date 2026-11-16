// The two phases of recording a build-cost acknowledgement, inside
// recordRomAcknowledgementCore's transaction: read the band the client was
// shown, then append the acknowledgement to the ledger with its audit row.
import { designEngagements, engagementEvents, type MetraDb } from '@metra/db';
import { sql } from 'drizzle-orm';
import { fail, requireInOrg } from '@/lib/actions/mutate';
import type { AuditEntry } from '@/lib/audit';
import type { OrgContext } from '@/lib/db/context';
import { isTerminal } from './states';

export interface AcknowledgeableRom {
  romLow: string;
  romHigh: string;
  romIssuedAt: Date;
}

interface RomAcknowledgementEntry {
  engagementId: string;
  engagement: AcknowledgeableRom;
  note: string | null;
  occurredOn: string | null;
  evidence: string | null;
}

/** The band a live engagement has set AND issued to the client, or the refusal that names what is missing. */
export async function requireAcknowledgeableRom(tx: MetraDb, engagementId: string): Promise<AcknowledgeableRom> {
  const engagement = await requireInOrg(
    tx,
    designEngagements,
    engagementId,
    {
      id: designEngagements.id,
      state: designEngagements.state,
      romLow: designEngagements.romLow,
      romHigh: designEngagements.romHigh,
      romIssuedAt: designEngagements.romIssuedAt,
    },
    'engagement_not_found',
  );
  // No acknowledging a range on a finished engagement (abandoned / closed).
  if (isTerminal(engagement.state)) fail('engagement_not_active');
  // Can't acknowledge a range that was never entered (Step 10's setEngagementRom).
  if (engagement.romLow === null || engagement.romHigh === null) {
    fail('rom_not_set');
  }
  // And no acknowledging a band the client was never shown. Gate B reads this
  // event as the client's consent, so recording one against an unissued band
  // would let the studio unlock the gate on a range it kept to itself.
  if (engagement.romIssuedAt === null) {
    fail('rom_not_issued');
  }
  return { romLow: engagement.romLow, romHigh: engagement.romHigh, romIssuedAt: engagement.romIssuedAt };
}

/** Appends the acknowledgement, snapshotting the band and its issuance, and audits it; answers the event id. */
export async function appendRomAcknowledgementEvent(
  tx: MetraDb,
  ctx: OrgContext,
  acknowledgement: RomAcknowledgementEntry,
  audit: (entry: AuditEntry) => Promise<void>,
): Promise<string> {
  const { engagementId, engagement, note, occurredOn, evidence } = acknowledgement;
  // Snapshot the CURRENT canonical ROM into the event so the acknowledged band
  // is frozen at ack time — a later ROM edit must not rewrite this witness.
  const [row] = await tx
    .insert(engagementEvents)
    .values({
      orgId: ctx.orgId,
      engagementId,
      kind: 'rom_acknowledgement',
      actorUserId: ctx.userId,
      rangeLow: engagement.romLow,
      rangeHigh: engagement.romHigh,
      // WHICH issuance the client answered (0049), read in the same tx as the
      // rom_not_issued check above, so the stamp and the precondition cannot
      // disagree. Without it a re-issue of the SAME numbers would leave this
      // row looking current forever — the band comparison cannot see that.
      acknowledgedIssueAt: engagement.romIssuedAt,
      note,
      occurredOn,
      evidence,
      // Stamped AFTER the reads, not at BEGIN. The column default is `now()`,
      // which is `transaction_timestamp()` — so two overlapping writers could
      // commit in one order and be stamped in the other, and the Budget tab
      // reads this table as a chronology. `setEngagementRomCore` sets the same
      // way; a ledger whose order is only trustworthy for one of its two
      // writers is not a trustworthy ledger.
      decidedAt: sql`clock_timestamp()`,
    })
    .returning({ id: engagementEvents.id });

  await audit({
    entity: 'design_engagement',
    entityId: engagementId,
    action: 'create',
    before: null,
    after: {
      event_id: row.id,
      kind: 'rom_acknowledgement',
      range_low: engagement.romLow,
      range_high: engagement.romHigh,
      occurred_on: occurredOn,
      evidence,
    },
  });
  return row.id;
}
