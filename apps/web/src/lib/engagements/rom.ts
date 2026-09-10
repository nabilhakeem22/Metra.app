// Design-Engagement Machine, Step 10 — `setEngagementRom`, the firm's coarse
// build-cost band (ROM). This is a PLAIN data-entry action, NOT a machine
// transition: it never moves state and touches no trigger. It writes the two
// pre-existing `rom_low`/`rom_high` numeric(18,4) columns on `design_engagements`
// (the table CHECK enforces `rom_high >= rom_low`) AND appends a `rom_range_set`
// row to the append-only engagement ledger — the columns are the current band,
// the event is the record that the band was ever offered (0042). Money is validated with exact
// scale-4 BigInt (never parseFloat) and stored canonically, mirroring the payment
// fix. The engagement is verified in-org (RLS scopes the read) and non-terminal
// before the write, so a caller cannot set ROM on a foreign or finished engagement.
import { designEngagements, engagementEvents } from '@metra/db';
import { and, eq, notInArray, sql } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import { MONEY_RE, formatMoney4, parseMoney4 } from '@/lib/aggregates/proposal-totals';
import type { OrgContext } from '@/lib/db/context';
import { isUuid } from '@/lib/uuid';
import { TERMINAL_STATES } from './states';

/** The terminal states as a list, for the admission gate's SQL predicate. */
const TERMINAL_STATE_LIST = [...TERMINAL_STATES];

export interface SetEngagementRomInput {
  engagementId: string;
  romLow: string;
  romHigh: string;
}

/**
 * The longest money string this system can mean: `numeric(18,4)` is 14 integer
 * digits and 4 decimals, so 19 characters plus a point.
 *
 * `MONEY_RE` bounds the SHAPE and not the LENGTH, so without this a megabyte of
 * digits -- the server-action body limit, not the field's -- reaches `BigInt`
 * before `numeric(18,4)` rejects it downstream. Cheap to send, not free to parse.
 */
const MAX_MONEY_CHARS = 20;

/** A well-formed scale-4 money string whose parsed value is strictly positive. */
function isPositiveMoneyString(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return (
    trimmed.length <= MAX_MONEY_CHARS &&
    MONEY_RE.test(trimmed) &&
    parseMoney4(trimmed) > 0n
  );
}

/**
 * Set the rough build-cost range (ROM) on an engagement. Gated on the
 * `engagements_design` capability (update). Flow: open the RLS tx; assert the
 * engagement resolves in-org (`engagement_not_found` if absent/foreign) and is
 * NOT terminal (`engagement_not_active`); validate that both `romLow` and
 * `romHigh` are well-formed positive scale-4 money strings and
 * `romHigh >= romLow` (else `rom_range_invalid`); persist the canonical scale-4
 * values so the STORED band is exactly the one the app validated (the DB
 * numeric(18,4) would otherwise round a >4-decimal input); append ONE
 * `rom_range_set` event carrying that same band, so what the firm quoted
 * survives the next revision. Returns ok. Never throws to the client — coded
 * ActionResult only.
 */
export async function setEngagementRomCore(
  ctx: OrgContext,
  input: SetEngagementRomInput,
): Promise<ActionResult> {
  // Shape-check the id BEFORE opening a transaction. A malformed one otherwise
  // reaches Postgres, raises on the `::uuid` cast, and is swallowed as `generic`
  // after a console.error -- so the caller learns nothing and the log fills up.
  // The same guard `recordArtifactCore` already applies.
  if (!isUuid(input.engagementId)) return Promise.resolve(err('invalid'));

  return mutateInOrg(
    ctx,
    { capability: 'engagements_design', action: 'update', flow: 'interior' },
    async (tx, audit) => {
      // Validate BEFORE touching a row: a malformed band must never take a lock.
      if (!isPositiveMoneyString(input.romLow)) fail('rom_range_invalid');
      if (!isPositiveMoneyString(input.romHigh)) fail('rom_range_invalid');
      const romLow4 = parseMoney4(input.romLow);
      const romHigh4 = parseMoney4(input.romHigh);
      if (romHigh4 < romLow4) fail('rom_range_invalid');

      const romLow = formatMoney4(romLow4);
      const romHigh = formatMoney4(romHigh4);

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
        .set({ romLow, romHigh, updatedAt: new Date() })
        .where(
          and(
            eq(designEngagements.id, input.engagementId),
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
          .where(eq(designEngagements.id, input.engagementId))
          .limit(1);
        fail(exists ? 'engagement_not_active' : 'engagement_not_found');
      }

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
          engagementId: input.engagementId,
          kind: 'rom_range_set',
          actorUserId: ctx.userId,
          rangeLow: romLow,
          rangeHigh: romHigh,
          decidedAt: sql`clock_timestamp()`,
        })
        .returning({ id: engagementEvents.id });

      await audit({
        entity: 'design_engagement',
        entityId: input.engagementId,
        action: 'update',
        before: null,
        // The event id travels with the audit row. Without it a duplicated or
        // disputed band cannot be tied back to the request that wrote it --
        // `recordRomAcknowledgement` already records its own event_id.
        after: { rom_low: romLow, rom_high: romHigh, event_id: event?.id ?? null },
      });
    },
  );
}
