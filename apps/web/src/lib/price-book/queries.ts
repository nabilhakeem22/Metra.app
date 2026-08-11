import 'server-only';
import { costItems, type CostItem, type CostItemCategory } from '@metra/db';
import { and, asc, eq, ilike, or, sql } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';

export interface ListCostItemsFilter {
  category?: CostItemCategory;
  active?: boolean;
  q?: string;
}

/** Org-scoped cost items, optionally filtered, ordered by category then code. */
export function listCostItems(
  ctx: OrgContext,
  filter: ListCostItemsFilter = {},
): Promise<CostItem[]> {
  return withOrgContext(ctx, (tx) => {
    const conds = [];
    if (filter.category) conds.push(eq(costItems.category, filter.category));
    if (filter.active !== undefined) conds.push(eq(costItems.active, filter.active));
    if (filter.q && filter.q.trim()) {
      const pattern = `%${filter.q.trim()}%`;
      conds.push(
        or(
          ilike(costItems.code, pattern),
          ilike(costItems.nameEn, pattern),
          ilike(costItems.nameAr, pattern),
        ),
      );
    }
    return tx
      .select()
      .from(costItems)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(asc(costItems.category), asc(costItems.code));
  });
}

/** The org's existing cost-item codes, lowercased — for insert-only import. */
export async function getExistingCodes(ctx: OrgContext): Promise<Set<string>> {
  const rows = await withOrgContext(ctx, (tx) =>
    tx.select({ code: costItems.code }).from(costItems),
  );
  return new Set(rows.map((r) => r.code.toLowerCase()));
}

/** Distinct count per category (for the empty-state / grouped headers). */
export function countByCategory(
  ctx: OrgContext,
): Promise<Array<{ category: CostItemCategory; n: number }>> {
  return withOrgContext(ctx, (tx) =>
    tx
      .select({
        category: costItems.category,
        n: sql<number>`count(*)::int`,
      })
      .from(costItems)
      .groupBy(costItems.category),
  );
}
