import 'server-only';
import {
  contracts,
  variationOrderEvents,
  variationOrders,
  type VariationStatus,
} from '@metra/db';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { boundedPage } from '@/lib/db/list-bounds';

export interface VariationListRow {
  id: string;
  number: number;
  titleAr: string | null;
  titleEn: string | null;
  status: VariationStatus;
  netDelta: string;
  /** Days the order adds to the contract's finish date; null = none (0063). */
  timeExtensionDays: number | null;
  contractId: string;
  contractNumber: number | null;
  createdAt: string;
  /**
   * WHO rejected it (0051): 'client' (online, or on paper as the studio
   * recorded it, H7.3), 'staff' (the termination cascade), or null for a row
   * written before the column. Meaningless unless `status` is `rejected`;
   * `lib/variations/status-label.ts` is the only reader.
   */
  rejectionChannel: string | null;
}

export interface ListVariationsFilter {
  contractId?: string;
  projectId?: string;
  status?: VariationStatus;
  limit?: number;
  offset?: number;
}

/** The register's columns, as DATA. No cost or margin reaches this surface. */
const VARIATION_LIST_COLUMNS = {
  id: variationOrders.id,
  number: variationOrders.number,
  titleAr: variationOrders.titleAr,
  titleEn: variationOrders.titleEn,
  status: variationOrders.status,
  netDelta: variationOrders.netDelta,
  timeExtensionDays: variationOrders.timeExtensionDays,
  contractId: variationOrders.contractId,
  contractNumber: contracts.number,
  createdAt: variationOrders.createdAt,
  // The newest `rejected` event's channel, as a correlated subquery rather than
  // a join: at most one row is wanted per variation order, and a join would
  // multiply the register by the whole event history. Covered by
  // variation_order_events_variationOrder_idx (org_id, variation_order_id), and
  // it reads a table this transaction is already scoped to by RLS. A refusal
  // the studio recorded on paper is the CLIENT's refusal (H7.3), never the
  // cascade: the same rule app_variation_by_token's `rejection_channel` reads.
  rejectionChannel: sql<string | null>`(
    select case when e.recorded_on_paper then 'client' else e.actor_channel end
    from ${variationOrderEvents} e
    where e.variation_order_id = ${variationOrders.id} and e.kind = 'rejected'
    order by e.decided_at desc, e.id desc limit 1)`,
} as const;

/** The filter as SQL. Every caller passes a parent, but none of them is a bound. */
function listConditions(filter: ListVariationsFilter): SQL[] {
  const conditions: SQL[] = [];
  if (filter.contractId) {
    conditions.push(eq(variationOrders.contractId, filter.contractId));
  }
  if (filter.projectId) {
    conditions.push(eq(variationOrders.projectId, filter.projectId));
  }
  if (filter.status) conditions.push(eq(variationOrders.status, filter.status));
  return conditions;
}

export function listVariations(
  ctx: OrgContext,
  filter: ListVariationsFilter = {},
): Promise<VariationListRow[]> {
  return withOrgContext(ctx, async (tx) => {
    const conditions = listConditions(filter);
    const page = boundedPage(filter);
    const rows = await tx
      .select(VARIATION_LIST_COLUMNS)
      .from(variationOrders)
      .leftJoin(contracts, eq(contracts.id, variationOrders.contractId))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(variationOrders.number))
      .limit(page.limit)
      .offset(page.offset);
    return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
  });
}
