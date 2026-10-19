import 'server-only';
// The rescue ledger, read for the dashboard island's route. Reads only.
import { unexpectedFailure } from '@/lib/actions/unexpected';
import type { OrgContext } from '@/lib/db/context';
import type { RangeMonths } from '../range';
import { loadRescueLedgerRows } from './queries';
import { shapeRescueLedger } from './shape';
import type { RescueLedger } from './types';
import { canSeeRescueLedger } from './visibility';

/** An ActionResult narrowed to the three answers this read can give. */
export type RescueLedgerResult =
  | { ok: true; data: RescueLedger }
  | { ok: false; error: 'forbidden' }
  | ReturnType<typeof unexpectedFailure>;

const FORBIDDEN = { ok: false, error: 'forbidden' } as const;

/**
 * `forbidden` for a role D1 never admits, BEFORE any query. For a role the org's
 * "limit firm figures" setting can narrow out (the accountant), the setting is
 * read in the same one statement as the ledger, which then stays uncomputed
 * when it refuses. A failed read is `generic` with a reference to its log line.
 */
export async function loadRescueLedgerCore(
  ctx: OrgContext,
  input: { range: RangeMonths },
): Promise<RescueLedgerResult> {
  if (!canSeeRescueLedger(ctx.role, { restrictFirmDashboard: false })) return FORBIDDEN;
  const withheldWhenRestricted = !canSeeRescueLedger(ctx.role, { restrictFirmDashboard: true });
  try {
    const read = await loadRescueLedgerRows(ctx, input.range, withheldWhenRestricted);
    if (!canSeeRescueLedger(ctx.role, { restrictFirmDashboard: read.restrictFirmDashboard })) return FORBIDDEN;
    return { ok: true, data: shapeRescueLedger(read.rows, input.range) };
  } catch (error) {
    return unexpectedFailure('rescue ledger read failed', error);
  }
}
