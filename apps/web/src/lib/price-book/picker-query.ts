import 'server-only';
import { costItems } from '@metra/db';
import { and, asc, eq, sql } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { PICKER_LIMIT, type PickerSearch } from './picker-types';
import { everyWordSql, nameInSql, nameSortKeySql } from './search-sql';
import { rankedSections } from './section-rank';

/**
 * The studio's ACTIVE items matching what was typed (every word, any order, in
 * the code or either name), at most PICKER_LIMIT of them: grouped by section,
 * sections and items ordered by name in the page's language, items under a
 * retired section last. `count(*) over ()` counts every match in the same
 * statement, before the limit. The cost comes back only `withCost` (canSeeMargin).
 */
export function searchPickerItems(
  ctx: OrgContext,
  query: string,
  locale: string,
  withCost: boolean,
): Promise<PickerSearch> {
  return withOrgContext(ctx, async (tx) => {
    const ranked = rankedSections(tx, locale);
    const rows = await tx
      .with(ranked)
      .select({
        id: costItems.id,
        code: costItems.code,
        sectionId: ranked.id,
        nameEn: costItems.nameEn,
        nameAr: costItems.nameAr,
        unit: costItems.unit,
        defaultUnitCost: withCost ? costItems.defaultUnitCost : sql<string | null>`null::text`,
        defaultUnitPrice: costItems.defaultUnitPrice,
        matched: sql<number>`(count(*) over ())::int`,
      })
      .from(costItems)
      .leftJoin(ranked, eq(ranked.id, costItems.sectionId))
      .where(
        and(
          eq(costItems.active, true),
          everyWordSql(sql`concat_ws(' ', ${costItems.code}, ${costItems.nameEn}, ${costItems.nameAr})`, query),
        ),
      )
      .orderBy(
        sql`${ranked.rank} asc nulls last`,
        nameSortKeySql(nameInSql(costItems.nameAr, costItems.nameEn, locale), locale),
        asc(costItems.id),
      )
      .limit(PICKER_LIMIT);
    return {
      items: rows.map(({ matched: _matched, ...item }) => item),
      matched: rows[0]?.matched ?? 0,
    };
  });
}

/** Whether the studio has any active item to pick: the builder shows the picker only then. */
export function hasActiveCostItem(ctx: OrgContext): Promise<boolean> {
  return withOrgContext(ctx, async (tx) => {
    const [found] = await tx.select({ id: costItems.id }).from(costItems).where(eq(costItems.active, true)).limit(1);
    return found !== undefined;
  });
}
