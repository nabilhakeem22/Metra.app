import 'server-only';
import { costItems, type CostItem, type MetraDb } from '@metra/db';
import { and, asc, eq, sql } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { PRICE_BOOK_PAGE_SIZE, type PriceBookView } from './page-params';
import { everyWordSql } from '@/lib/search/words-sql';
import { nameInSql, nameSortKeySql } from './search-sql';
import { rankedSections } from './section-rank';

/** One row of the price book table: only what the table and the edit form show. */
const ROW_COLUMNS = {
  id: costItems.id,
  code: costItems.code,
  nameEn: costItems.nameEn,
  nameAr: costItems.nameAr,
  sectionId: costItems.sectionId,
  unit: costItems.unit,
  defaultUnitCost: costItems.defaultUnitCost,
  defaultUnitPrice: costItems.defaultUnitPrice,
  taxCode: costItems.taxCode,
  etaItemCode: costItems.etaItemCode,
  etaCodeType: costItems.etaCodeType,
  active: costItems.active,
  marketItemId: costItems.marketItemId,
};

export type PriceBookRow = Pick<CostItem, keyof typeof ROW_COLUMNS>;

export interface PriceBookPage {
  rows: PriceBookRow[];
  /** How many items match in each section on this page, across every page (a section can run over two). */
  sectionCounts: Record<string, number>;
  /** How many items match, across every page. */
  matched: number;
  /** The page shown: the one asked for, or the last one when it asked past the end. */
  page: number;
  pageCount: number;
  /** Whether the book holds any item at all, whatever the filters: an empty book offers to fill it. */
  hasAnyItem: boolean;
}

/**
 * One page of matching items, sections by name in the page's language then
 * items by name, with the counts as window functions of the SAME statement: the
 * row-level security every row pays is paid once per page, not once per count.
 * Items under a retired section are never listed (they have no heading).
 */
async function readPage(tx: MetraDb, view: PriceBookView, locale: string, page: number) {
  const ranked = rankedSections(tx, locale);
  return tx
    .with(ranked)
    .select({
      ...ROW_COLUMNS,
      sectionMatched: sql<number>`(count(*) over (partition by ${costItems.sectionId}))::int`,
      matched: sql<number>`(count(*) over ())::int`,
    })
    .from(costItems)
    .innerJoin(ranked, eq(ranked.id, costItems.sectionId))
    .where(
      and(
        view.sectionId ? eq(costItems.sectionId, view.sectionId) : undefined,
        view.activeOnly ? eq(costItems.active, true) : undefined,
        everyWordSql(sql`concat_ws(' ', ${costItems.code}, ${costItems.nameEn}, ${costItems.nameAr})`, view.query),
      ),
    )
    .orderBy(ranked.rank, nameSortKeySql(nameInSql(costItems.nameAr, costItems.nameEn, locale), locale), asc(costItems.id))
    .limit(PRICE_BOOK_PAGE_SIZE)
    .offset((page - 1) * PRICE_BOOK_PAGE_SIZE);
}

/**
 * One page of the studio's price book, filtered, searched and ordered in the
 * database. A page past the end (an item retired meanwhile, an old link) is
 * read again as the last page; nothing matching asks whether the book is empty.
 */
export function listPriceBookPage(ctx: OrgContext, view: PriceBookView, locale: string): Promise<PriceBookPage> {
  return withOrgContext(ctx, async (tx) => {
    let page = view.page;
    let found = await readPage(tx, view, locale, page);
    if (found.length === 0 && page > 1) {
      const [last] = await readPage(tx, view, locale, 1);
      page = last ? Math.ceil(last.matched / PRICE_BOOK_PAGE_SIZE) : 1;
      found = last ? await readPage(tx, view, locale, page) : [];
    }
    if (found.length === 0) {
      const [anyItem] = await tx.select({ id: costItems.id }).from(costItems).limit(1);
      return { rows: [], sectionCounts: {}, matched: 0, page: 1, pageCount: 1, hasAnyItem: anyItem !== undefined };
    }
    const matched = found[0].matched;
    const sectionCounts: Record<string, number> = {};
    const rows = found.map(({ sectionMatched, matched: _matched, ...row }) => {
      sectionCounts[row.sectionId] = sectionMatched;
      return row;
    });
    return { rows, sectionCounts, matched, page, pageCount: Math.ceil(matched / PRICE_BOOK_PAGE_SIZE), hasAnyItem: true };
  });
}
