import 'server-only';
import { sections, type MetraDb } from '@metra/db';
import { eq, sql } from 'drizzle-orm';
import { nameInSql, nameSortKeySql } from './search-sql';

/**
 * The studio's active sections, each with its place in the page's language
 * (`rank`, 1 = first by name). A WITH clause, so a query over thousands of
 * items orders its sections by a number instead of working out every row's
 * section name key again.
 */
export function rankedSections(tx: MetraDb, locale: string) {
  return tx.$with('ranked_sections').as(
    tx
      .select({
        id: sections.id,
        rank: sql<number>`row_number() over (order by ${nameSortKeySql(nameInSql(sections.nameAr, sections.nameEn, locale), locale)}, ${sections.id})`.as('rank'),
      })
      .from(sections)
      .where(eq(sections.active, true)),
  );
}
