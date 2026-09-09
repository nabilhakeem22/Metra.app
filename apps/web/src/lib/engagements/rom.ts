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
import { eq } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import type { ActionResult } from '@/lib/actions/result';
import { MONEY_RE, formatMoney4, parseMoney4 } from '@/lib/aggregates/proposal-totals';
import type { OrgContext } from '@/lib/db/context';
import { isTerminal } from './states';

export interface SetEngagementRomInput {
  engagementId: string;
  romLow: string;
  romHigh: string;
}

/** A well-formed scale-4 money string whose parsed value is strictly positive. */
function isPositiveMoneyString(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    MONEY_RE.test(value.trim()) &&
    parseMoney4(value) > 0n
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
  return mutateInOrg(
    ctx,
    { capability: 'engagements_design', action: 'update', flow: 'interior' },
    async (tx, audit) => {
      const [engagement] = await tx
        .select({ id: designEngagements.id, state: designEngagements.state })
        .from(designEngagements)
        .where(eq(designEngagements.id, input.engagementId))
        .limit(1);
      if (!engagement) fail('engagement_not_found');
      // No setting a ROM on a finished engagement (abandoned / closed).
      if (isTerminal(engagement.state)) fail('engagement_not_active');

      if (!isPositiveMoneyString(input.romLow)) fail('rom_range_invalid');
      if (!isPositiveMoneyString(input.romHigh)) fail('rom_range_invalid');
      const romLow4 = parseMoney4(input.romLow);
      const romHigh4 = parseMoney4(input.romHigh);
      if (romHigh4 < romLow4) fail('rom_range_invalid');

      const romLow = formatMoney4(romLow4);
      const romHigh = formatMoney4(romHigh4);

      await tx
        .update(designEngagements)
        .set({ romLow, romHigh, updatedAt: new Date() })
        .where(eq(designEngagements.id, input.engagementId));

      // ...and append the band to the LEDGER, in the same transaction. The
      // columns above are the CURRENT value, which is what a guard asking "what
      // is it now" needs and what a studio asking "what did we tell them in
      // August" cannot use, because a revision overwrites them.
      // `rom_acknowledgement` already snapshots the acknowledged band; this is
      // the missing half -- every band ISSUED, acknowledged or not. The two kinds
      // interleave by decided_at into one history.
      await tx.insert(engagementEvents).values({
        orgId: ctx.orgId,
        engagementId: input.engagementId,
        kind: 'rom_range_set',
        actorUserId: ctx.userId,
        rangeLow: romLow,
        rangeHigh: romHigh,
      });

      await audit({
        entity: 'design_engagement',
        entityId: input.engagementId,
        action: 'update',
        before: null,
        after: { rom_low: romLow, rom_high: romHigh },
      });
    },
  );
}
