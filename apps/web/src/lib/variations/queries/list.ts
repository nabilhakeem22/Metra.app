import 'server-only';
import { contracts, variationOrders, type VariationStatus } from '@metra/db';
import { and, desc, eq } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';

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
}

export function listVariations(
  ctx: OrgContext,
  filter: ListVariationsFilter = {},
): Promise<VariationListRow[]> {
  return withOrgContext(ctx, async (tx) => {
    const conds = [];
    if (filter.contractId) conds.push(eq(variationOrders.contractId, filter.contractId));
    if (filter.projectId) conds.push(eq(variationOrders.projectId, filter.projectId));
    if (filter.status) conds.push(eq(variationOrders.status, filter.status));
    const rows = await tx
      .select({
        id: variationOrders.id,
        number: variationOrders.number,
        titleAr: variationOrders.titleAr,
        titleEn: variationOrders.titleEn,
        status: variationOrders.status,
        netDelta: variationOrders.netDelta,
        contractId: variationOrders.contractId,
        contractNumber: contracts.number,
        createdAt: variationOrders.createdAt,
      })
      .from(variationOrders)
      .leftJoin(contracts, eq(contracts.id, variationOrders.contractId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(variationOrders.number));
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  });
}
