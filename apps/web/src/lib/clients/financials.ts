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
import { contracts, variationOrders, type MetraDb } from '@metra/db';
import { and, eq, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import { formatMoney4, parseMoney4 } from '@/lib/aggregates/proposal-totals';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { executionRevisedValue } from '@/lib/execution/money/variation-charge';
import { weightedRates, type ClientEffectiveRates } from './rates';

/** Contract statuses that represent a real commercial commitment. `draft` is a
 *  work-in-progress and must not drag the client's effective rate around;
 *  `terminated` is no longer a commitment. That leaves issued + signed. */
export const COMMITTED_STATUSES = ['issued', 'signed'] as const;

/**
 * The REVISED value of the committed (issued or signed) EXECUTION contracts
 * `scope` selects, as a scale-4 string: the part of a contracted value with no
 * accepted proposal behind it (A5 fix round F4). Each contract counts its
 * original value plus every approved change order's full charge, VAT and
 * supervision included (D4a, `executionRevisedValue`), exactly as its contract
 * page shows it. A proposal contract is its accepted proposal, so a caller
 * adding this to its accepted-proposal sum counts that contract once. Draft and
 * terminated contracts are not counted. One statement: each contract's
 * approved net changes arrive as one short array, and the money rule (rounded
 * per order) runs here in exact scale-4 BigInt.
 */
export async function committedExecutionValue(tx: MetraDb, scope: SQL): Promise<string> {
  const rows = await tx
    .select({
      originalValue: sql<string>`${contracts.originalValue}::text`,
      taxRate: sql<string>`${contracts.taxRate}::text`,
      supervisionPct: sql<string>`${contracts.supervisionPct}::text`,
      approvedNetDeltas: sql<string[]>`coalesce(jsonb_agg(${variationOrders.netDelta}::text) filter (where ${variationOrders.id} is not null), '[]'::jsonb)`,
    })
    .from(contracts)
    .leftJoin(
      variationOrders,
      and(eq(variationOrders.contractId, contracts.id), eq(variationOrders.status, 'approved')),
    )
    .where(and(scope, isNotNull(contracts.sourceBoqId), inArray(contracts.status, [...COMMITTED_STATUSES])))
    .groupBy(contracts.id);
  const total4 = rows.reduce(
    (total, row) =>
      total + parseMoney4(executionRevisedValue(row.originalValue, row.approvedNetDeltas, row.taxRate, row.supervisionPct)),
    0n,
  );
  return formatMoney4(total4);
}

/** The effective rates, and how many committed EXECUTION contracts sit beside them. */
export interface EffectiveRates extends ClientEffectiveRates {
  executionContractCount: number;
}

/**
 * The effective advance/retention of the committed contracts `scope` selects:
 * each contract's percentage WEIGHTED BY ITS VALUE, not a plain average. A 5%
 * advance on a 2,000,000 contract and a 25% advance on a 50,000 one is not
 * "15% advance" in any sense a firm would recognise: the weighted figure
 * (5.5%) is the one that describes their cash.
 *
 * Only PROPOSAL contracts carry the two rates. An execution contract (from a
 * BOQ) has no advance or retention terms: its schedule's first and last rows
 * are those, and both columns are stored 0 (plan A5). Weighting its 0 in would
 * drag a real rate down, and where there are only execution contracts the
 * cards would read "0.00%" for terms that do not exist, so the Financials tabs
 * hide them there (A5 fix round F4, `showsContractRates`);
 * `executionContractCount` says so.
 *
 * Exact scale-4 BigInt throughout (never parseFloat), matching the money engine.
 * Nulls rather than zeros when no proposal contract is committed: "no contracts
 * yet" and "0% advance" are different facts and must not render identically.
 */
function getEffectiveRates(ctx: OrgContext, scope: SQL): Promise<EffectiveRates> {
  return withOrgContext(ctx, async (tx) => {
    const committed = and(scope, inArray(contracts.status, [...COMMITTED_STATUSES]));
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
      .where(and(committed, isNull(contracts.sourceBoqId)));
    const [execution] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(contracts)
      .where(and(committed, isNotNull(contracts.sourceBoqId)));
    return { ...weightedRates(rows), executionContractCount: execution?.count ?? 0 };
  });
}

/** The client's effective rates, across every project of theirs. */
export function getClientEffectiveRates(ctx: OrgContext, clientId: string): Promise<EffectiveRates> {
  return getEffectiveRates(ctx, eq(contracts.clientId, clientId));
}

/**
 * The same calculation, scoped to ONE PROJECT. The projects spec asks for
 * Financials to behave "the same as clients", and the arithmetic is identical:
 * only the scope differs, so both share one query rather than two copies that
 * could drift.
 */
export function getProjectEffectiveRates(ctx: OrgContext, projectId: string): Promise<EffectiveRates> {
  return getEffectiveRates(ctx, eq(contracts.projectId, projectId));
}
