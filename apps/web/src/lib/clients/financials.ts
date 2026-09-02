import 'server-only';
// Client Financials — the advance/retention a client is ACTUALLY on, derived from
// their contracts rather than read from a typed-in default on the client record.
//
// WHY: `clients.advance_pct` / `retention_pct` were free-text fields on the client
// form. They were a wish, not a fact: the percentages that govern real money live on
// each CONTRACT, and nothing kept the client-level number in step with them. The
// Details form no longer offers them, and this is what the Financials cards read.
//
// The client columns are deliberately KEPT (and still served by Public API v1 as
// `advance_pct` / `retention_pct`) — removing them would be a breaking API change
// for no gain, and they remain a usable default when a contract is drafted.
import { contracts } from '@metra/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { weightedRates, type ClientEffectiveRates } from './rates';

/** Contract statuses that represent a real commercial commitment. `draft` is a
 *  work-in-progress and must not drag the client's effective rate around;
 *  `terminated` is no longer a commitment. That leaves issued + signed. */
const COMMITTED_STATUSES = ['issued', 'signed'] as const;

/**
 * The client's effective advance/retention: each committed contract's percentage
 * WEIGHTED BY ITS VALUE, not a plain average. A 5% advance on a 2,000,000 contract
 * and a 25% advance on a 50,000 one is not "15% advance" in any sense a firm would
 * recognise — the weighted figure (5.5%) is the one that describes their cash.
 *
 * Exact scale-4 BigInt throughout (never parseFloat), matching the money engine.
 * Returns nulls rather than zeros when there is nothing committed: "no contracts
 * yet" and "0% advance" are different facts and must not render identically.
 */
export function getClientEffectiveRates(
  ctx: OrgContext,
  clientId: string,
): Promise<ClientEffectiveRates> {
  return withOrgContext(ctx, async (tx) => {
    const rows = await tx
      .select({
        advancePct: contracts.advancePct,
        retentionPct: contracts.retentionPct,
        // Weighted by ORIGINAL value. The revised value (original + approved
        // variation deltas) is a computed aggregate that would need a second join;
        // for weighting two percentages the original is the right order of
        // magnitude, and it never silently disagrees with a stored column.
        value: sql<string>`coalesce(${contracts.originalValue}, 0)::text`,
      })
      .from(contracts)
      .where(
        and(
          eq(contracts.clientId, clientId),
          inArray(contracts.status, [...COMMITTED_STATUSES]),
        ),
      );

    return weightedRates(rows);
  });
}
