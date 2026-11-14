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
import { failFields } from '@/lib/actions/field-errors';
import { mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { isUuid } from '@/lib/uuid';
import { admitRomBand, appendRomBandEvent } from './rom-band-writes';
import { readRomRange } from './rom-field-rules';

export interface SetEngagementRomInput {
  engagementId: string;
  romLow: string;
  romHigh: string;
}

/**
 * Set the rough build-cost range (ROM) on an engagement. Gated on the
 * `engagements_design` capability (update). Flow: shape-check the engagement id
 * before any transaction (else `malformed`); open the RLS tx; validate that both
 * `romLow` and `romHigh` are well-formed positive scale-4 money strings and
 * `romHigh >= romLow`, refusing under the field before any row is touched
 * (`check_fields`, with `rom_range_invalid` for an empty, zero or inverted
 * band); write the canonical scale-4 values in ONE update that admits only an
 * engagement that is NOT terminal, so the STORED band is exactly the one the app
 * validated (the DB numeric(18,4) would otherwise round a >4-decimal input), and
 * that CLEARS `rom_issued_at`, so a revised band is hidden from the client until
 * it is deliberately re-issued; when that update admits nothing, answer
 * `engagement_not_active` if the engagement resolves in-org and
 * `engagement_not_found` if it is absent/foreign; append ONE `rom_range_set`
 * event carrying that same band, so what the firm quoted survives the next
 * revision. Returns ok. Never throws to the client — coded ActionResult only.
 */
export async function setEngagementRomCore(
  ctx: OrgContext,
  input: SetEngagementRomInput,
): Promise<ActionResult> {
  // Shape-check the id BEFORE opening a transaction. A malformed one otherwise
  // reaches Postgres, raises on the `::uuid` cast, and is swallowed as `generic`
  // after a console.error -- so the caller learns nothing and the log fills up.
  // The same guard `recordArtifactCore` already applies.
  if (!isUuid(input.engagementId)) return Promise.resolve(err('malformed'));

  return mutateInOrg(
    ctx,
    { capability: 'engagements_design', action: 'update', flow: 'interior' },
    async (tx, audit) => {
      // Validate BEFORE touching a row: a malformed band must never take a lock.
      const range = readRomRange(input);
      if (!range.ok) failFields(range.errors);
      const { romLow, romHigh } = range;

      await admitRomBand(tx, input.engagementId, { romLow, romHigh });
      await appendRomBandEvent(tx, ctx, input.engagementId, { romLow, romHigh }, audit);
    },
  );
}
