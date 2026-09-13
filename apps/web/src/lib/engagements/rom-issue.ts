// Design-Engagement Machine, Step 10b — `issueRom`, the deliberate act of
// sending the build-cost band to the client. Setting the band (rom.ts) is
// private working state; THIS is the moment it reaches the delivery portal and
// becomes acknowledgeable. A PLAIN data-entry action, NOT a machine transition:
// it moves no state. Owner/admin only (engagements_issue / approve), because it
// is what mints a client-facing figure — the same posture as issuing a contract.
import { designEngagements, engagementEvents, type MetraDb } from '@metra/db';
import { and, eq, isNotNull, isNull, notInArray, sql } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import type { ActionCode } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { isUuid } from '@/lib/uuid';
import { TERMINAL_STATES } from './states';

/** The terminal states as a list, for the admission gate's SQL predicate. */
const TERMINAL_STATE_LIST = [...TERMINAL_STATES];

export interface IssueRomInput {
  engagementId: string;
}

/**
 * Why the atomic gate admitted nothing. Runs only on the failure path, so the
 * happy path stays one statement: absent/foreign (RLS hides it) reads as
 * not-found, already stamped reads as already-issued, no band reads as not-set,
 * and anything else left is a finished engagement.
 */
async function explainIssueFailure(
  tx: MetraDb,
  engagementId: string,
): Promise<ActionCode> {
  const [row] = await tx
    .select({
      state: designEngagements.state,
      romLow: designEngagements.romLow,
      romHigh: designEngagements.romHigh,
      romIssuedAt: designEngagements.romIssuedAt,
    })
    .from(designEngagements)
    .where(eq(designEngagements.id, engagementId))
    .limit(1);
  if (!row) return 'engagement_not_found';
  if (row.romIssuedAt !== null) return 'rom_already_issued';
  if (row.romLow === null || row.romHigh === null) return 'rom_not_set';
  return 'engagement_not_active';
}

/** The band an issue admitted, or null when the gate matched no row. */
type IssuedBand = { romLow: string | null; romHigh: string | null } | null;

/**
 * AN ATOMIC ADMISSION GATE, not a read-then-write, for the same reason every
 * other write in this module is one: the predicate carries "not already issued",
 * "a band exists" and "not finished", so a second click racing the first finds
 * zero rows instead of stamping twice and appending a second ledger row that the
 * INSERT-only grants on `engagement_events` mean nobody can take back.
 */
async function admitRomIssue(tx: MetraDb, engagementId: string): Promise<IssuedBand> {
  const [issued] = await tx
    .update(designEngagements)
    .set({ romIssuedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(designEngagements.id, engagementId),
        isNull(designEngagements.romIssuedAt),
        isNotNull(designEngagements.romLow),
        isNotNull(designEngagements.romHigh),
        notInArray(designEngagements.state, TERMINAL_STATE_LIST),
      ),
    )
    .returning({
      romLow: designEngagements.romLow,
      romHigh: designEngagements.romHigh,
    });
  return issued ?? null;
}

/**
 * Witness the issue on the append-only ledger. `decided_at` is set explicitly to
 * clock_timestamp(): the column default is now(), which is fixed at BEGIN, so two
 * overlapping writes could commit in lock order and be stamped in the opposite one.
 */
async function appendRomIssuedEvent(
  tx: MetraDb,
  ctx: OrgContext,
  engagementId: string,
  band: NonNullable<IssuedBand>,
): Promise<string | null> {
  const [event] = await tx
    .insert(engagementEvents)
    .values({
      orgId: ctx.orgId,
      engagementId,
      kind: 'rom_issued',
      actorUserId: ctx.userId,
      rangeLow: band.romLow,
      rangeHigh: band.romHigh,
      decidedAt: sql`clock_timestamp()`,
    })
    .returning({ id: engagementEvents.id });
  return event?.id ?? null;
}

/**
 * Issue the engagement's build-cost band to the client. Gated on the
 * `engagements_issue` capability (approve) and the interior flow: the atomic
 * gate admits one caller, the ledger witnesses it, the audit records it.
 */
export async function issueRomCore(
  ctx: OrgContext,
  input: IssueRomInput,
): Promise<ActionResult> {
  // Shape-check the id BEFORE opening a transaction: a malformed one otherwise
  // raises on the ::uuid cast and is swallowed as `generic`.
  if (!isUuid(input.engagementId)) return Promise.resolve(err('invalid'));

  return mutateInOrg(
    ctx,
    { capability: 'engagements_issue', action: 'approve', flow: 'interior' },
    async (tx, audit) => {
      const band = await admitRomIssue(tx, input.engagementId);
      if (!band) fail(await explainIssueFailure(tx, input.engagementId));

      const eventId = await appendRomIssuedEvent(tx, ctx, input.engagementId, band);
      await audit({
        entity: 'design_engagement',
        entityId: input.engagementId,
        action: 'issue',
        before: null,
        after: { rom_low: band.romLow, rom_high: band.romHigh, event_id: eventId },
      });
    },
  );
}
