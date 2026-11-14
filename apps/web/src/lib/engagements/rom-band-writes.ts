// The two writes of setting a build-cost band (ROM), inside setEngagementRomCore's
// transaction: admit the band onto a live engagement, then append it to the
// ledger with its audit row.
import { designEngagements, engagementEvents, type MetraDb } from '@metra/db';
import { and, eq, notInArray, sql } from 'drizzle-orm';
import { fail } from '@/lib/actions/mutate';
import type { AuditEntry } from '@/lib/audit';
import type { OrgContext } from '@/lib/db/context';
import { TERMINAL_STATES } from './states';

/** The terminal states as a list, for the admission gate's SQL predicate. */
const TERMINAL_STATE_LIST = [...TERMINAL_STATES];

export interface RomBand {
  romLow: string;
  romHigh: string;
}

/** Writes the band onto the engagement if it is live, or refuses saying why it is not. */
export async function admitRomBand(tx: MetraDb, engagementId: string, band: RomBand): Promise<void> {
  const { romLow, romHigh } = band;
  // AN ATOMIC ADMISSION GATE, not a read-then-write. The previous shape --
  // SELECT the state, check `isTerminal`, then UPDATE by id -- passed its
  // check on a pre-lock snapshot, so a ROM set racing an `abandon` wrote
  // anyway. That used to corrupt two mutable columns; now it would also
  // append a ledger row to a closed engagement, and the INSERT-only grants on
  // `engagement_events` mean nobody can take that row back. Folding the state
  // into the predicate makes the lock and the check the same act, which is
  // the rule `executor.ts` already follows for every machine transition.
  const updated = await tx
    .update(designEngagements)
    // rom_issued_at is reset UNCONDITIONALLY. A band the client has seen is
    // a number they may be budgeting against, so changing it un-tells them:
    // the portal goes quiet and the studio has to issue the new band
    // deliberately. Setting the same numbers again still resets it, because
    // "same numbers" is not something this core can assert about what the
    // client actually received.
    .set({ romLow, romHigh, romIssuedAt: null, updatedAt: new Date() })
    .where(
      and(
        eq(designEngagements.id, engagementId),
        notInArray(designEngagements.state, TERMINAL_STATE_LIST),
      ),
    )
    .returning({ id: designEngagements.id });

  if (updated.length === 0) {
    // Nothing was admitted. Separate the two reasons so the caller still gets
    // the specific error it always did: absent/foreign (RLS hides it) reads as
    // not-found, present-but-finished reads as not-active.
    const [exists] = await tx
      .select({ id: designEngagements.id })
      .from(designEngagements)
      .where(eq(designEngagements.id, engagementId))
      .limit(1);
    fail(exists ? 'engagement_not_active' : 'engagement_not_found');
  }
}

/** Appends the admitted band to the ledger and audits it with the event's id. */
export async function appendRomBandEvent(
  tx: MetraDb,
  ctx: OrgContext,
  engagementId: string,
  band: RomBand,
  audit: (entry: AuditEntry) => Promise<void>,
): Promise<void> {
  const { romLow, romHigh } = band;
  // ...and append the band to the LEDGER, in the same transaction, gated on
  // the admission above. The columns are the CURRENT value, which is what a
  // guard asking "what is it now" needs and what a studio asking "what did we
  // tell them in August" cannot use, because a revision overwrites them.
  // `rom_acknowledgement` already snapshots the acknowledged band; this is the
  // missing half -- every band ISSUED, acknowledged or not.
  //
  // `decided_at` IS SET EXPLICITLY to clock_timestamp(). The column's default
  // is now(), which is transaction_timestamp() -- fixed at BEGIN, several
  // round trips before this transaction took its row lock. Two overlapping ROM
  // writes could therefore commit in lock order but be stamped in the opposite
  // order, leaving the newest row in the history disagreeing with the column
  // rendered directly above it on the Budget tab. clock_timestamp() is read
  // here, after the lock, so the stamps follow the same order the writes did.
  const [event] = await tx
    .insert(engagementEvents)
    .values({
      orgId: ctx.orgId,
      engagementId,
      kind: 'rom_range_set',
      actorUserId: ctx.userId,
      rangeLow: romLow,
      rangeHigh: romHigh,
      decidedAt: sql`clock_timestamp()`,
    })
    .returning({ id: engagementEvents.id });

  await audit({
    entity: 'design_engagement',
    entityId: engagementId,
    action: 'update',
    before: null,
    // The event id travels with the audit row. Without it a duplicated or
    // disputed band cannot be tied back to the request that wrote it --
    // `recordRomAcknowledgement` already records its own event_id.
    after: { rom_low: romLow, rom_high: romHigh, event_id: event?.id ?? null },
  });
}
