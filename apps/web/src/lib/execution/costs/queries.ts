import 'server-only';
// The Costs tab's read: one page of a contract's cost entries, newest first,
// keyset-paged on (incurred_on desc, id desc) over the table's own index, so a
// page costs the Worker COST_ENTRIES_PAGE_SIZE rows however many entries the
// contract holds (AC37). The market reference is joined in the SAME statement
// from the seed book (A16), and only where the units compare; the first page
// also sums the live entries in SQL. Who recorded an entry never leaves this
// module: each row says only whether THIS member may edit it (./access.ts).
import {
  contractCostEntries,
  contractLines,
  contractSections,
  contracts,
  costItems,
  marketSeedBook,
} from '@metra/db';
import { and, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { priceVariance } from '@/lib/market-book/variance';
import { mayChangeCostEntry } from './access';
import {
  COST_ENTRIES_PAGE_SIZE,
  type CostEntriesCursor,
  type CostEntriesFilter,
  type CostEntriesPage,
  type CostEntryMarketReference,
  type CostEntryRow,
} from './types';

export interface CostEntriesRequest {
  contractId: string;
  filter: CostEntriesFilter;
  /** Null for the first page. */
  cursor: CostEntriesCursor | null;
}

const e = contractCostEntries;

const ROW_COLUMNS = {
  id: e.id,
  category: e.category,
  description: e.description,
  amount: e.amount,
  incurredOn: e.incurredOn,
  qty: e.qty,
  unit: e.unit,
  unitCost: e.unitCost,
  supplier: e.supplier,
  reference: e.reference,
  contractSectionId: e.contractSectionId,
  sectionTitleAr: contractSections.titleAr,
  sectionTitleEn: contractSections.titleEn,
  contractLineId: e.contractLineId,
  lineDescriptionAr: contractLines.descriptionAr,
  lineDescriptionEn: contractLines.descriptionEn,
  costItemId: e.costItemId,
  costItemCode: costItems.code,
  costItemNameAr: costItems.nameAr,
  costItemNameEn: costItems.nameEn,
  voidedAt: e.voidedAt,
  recordedBy: e.recordedBy,
  /** The seed book's unit cost of the linked market item, joined only on the entry's own unit. */
  marketUnitCost: marketSeedBook.unitCost,
};

function matching(request: CostEntriesRequest): SQL | undefined {
  return and(
    eq(e.contractId, request.contractId),
    request.filter.category ? eq(e.category, request.filter.category) : undefined,
    request.filter.sectionId ? eq(e.contractSectionId, request.filter.sectionId) : undefined,
  );
}

/** For reference only: the market's figure and how far the entry's unit cost is from it. */
function marketReference(unitCost: string | null, marketUnitCost: string | null): CostEntryMarketReference | null {
  if (unitCost === null || marketUnitCost === null) return null;
  const variance = priceVariance(unitCost, marketUnitCost);
  return variance.variancePct === null ? null : { unitCost: marketUnitCost, variancePct: variance.variancePct };
}

/**
 * One page of the contract's entries (voided ones included, marked), or null
 * when the contract is not the caller's to see (RLS, or no such id).
 */
export function listCostEntries(ctx: OrgContext, request: CostEntriesRequest): Promise<CostEntriesPage | null> {
  return withOrgContext(ctx, async (tx) => {
    const [contract] = await tx.select({ id: contracts.id }).from(contracts).where(eq(contracts.id, request.contractId)).limit(1);
    if (!contract) return null;
    const { cursor } = request;
    const rows = await tx
      .select(ROW_COLUMNS)
      .from(e)
      .leftJoin(contractSections, eq(contractSections.id, e.contractSectionId))
      .leftJoin(contractLines, eq(contractLines.id, e.contractLineId))
      .leftJoin(costItems, eq(costItems.id, e.costItemId))
      // The seed book's unit is the market unit's studio twin, so this join IS the units-compare rule.
      .leftJoin(marketSeedBook, and(eq(marketSeedBook.itemId, costItems.marketItemId), eq(marketSeedBook.unit, e.unit)))
      .where(and(matching(request), cursor ? sql`(${e.incurredOn}, ${e.id}) < (${cursor.incurredOn}::date, ${cursor.id}::uuid)` : undefined))
      .orderBy(desc(e.incurredOn), desc(e.id))
      .limit(COST_ENTRIES_PAGE_SIZE + 1);
    const page = rows.slice(0, COST_ENTRIES_PAGE_SIZE);
    const last = page.at(-1);
    const entries = page.map(({ voidedAt, recordedBy, marketUnitCost, ...row }): CostEntryRow => ({
      ...row,
      voided: voidedAt !== null,
      editable: mayChangeCostEntry(ctx.role, { recordedBy }, ctx.userId),
      market: marketReference(row.unitCost, marketUnitCost),
    }));
    const next = rows.length > COST_ENTRIES_PAGE_SIZE && last ? { incurredOn: last.incurredOn, id: last.id } : null;
    if (cursor) return { entries, next, totals: null };
    const [totals] = await tx
      // Plain numeric, kept at 4 decimals: a sum may pass what one entry's
      // numeric(18,4) holds (101 entries at the cap), and must still load.
      .select({ count: sql<number>`count(*)::int`, amount: sql<string>`round(coalesce(sum(${e.amount}), 0), 4)::text` })
      .from(e)
      .where(and(matching(request), isNull(e.voidedAt)));
    return { entries, next, totals };
  });
}
