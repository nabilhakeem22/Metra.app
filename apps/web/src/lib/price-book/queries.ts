import 'server-only';
import { costItems, type CostItem } from '@metra/db';
import { and, asc, eq, ilike, or } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';

export interface ListCostItemsFilter {
  sectionId?: string;
  active?: boolean;
  q?: string;
}

/** Org-scoped cost items, optionally filtered, ordered by section then code. */
export function listCostItems(
  ctx: OrgContext,
  filter: ListCostItemsFilter = {},
): Promise<CostItem[]> {
  return withOrgContext(ctx, (tx) => {
    const conds = [];
    if (filter.sectionId) conds.push(eq(costItems.sectionId, filter.sectionId));
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
      .orderBy(asc(costItems.sectionId), asc(costItems.code));
  });
}
