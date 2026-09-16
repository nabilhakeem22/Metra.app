import 'server-only';
import { contracts, variationOrders, type VariationStatus } from '@metra/db';
import { and, desc, eq, type SQL } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { boundedPage } from '@/lib/db/list-bounds';

export interface VariationListRow {
  id: string;
  number: number;
  titleAr: string | null;
  titleEn: string | null;
  status: VariationStatus;
  netDelta: string;
  contractId: string;
  contractNumber: number | null;
  createdAt: string;
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
  contractId: variationOrders.contractId,
  contractNumber: contracts.number,
  createdAt: variationOrders.createdAt,
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
