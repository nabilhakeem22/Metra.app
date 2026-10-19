import 'server-only';
// The sections the contract page opens with: counted in SQL, and holding only
// the lines of the opening window, so the page costs the same for a 20-line
// contract and a 2,000-line one. The rest of each section's lines load on
// demand through ./section-lines.ts.
import { contractLines, contractSections, type MetraDb } from '@metra/db';
import { eq, sql } from 'drizzle-orm';
import type { ContractLineView, ContractSectionSummary } from './detail-types';
import { LINE_ORDER, LINE_VIEW_COLUMNS, LINES_PAGE_SIZE, SECTION_ORDER } from './line-view';

/** Each section with its line count, counted by Postgres in one GROUP BY. */
function readCountedSections(tx: MetraDb, contractId: string) {
  return tx
    .select({
      id: contractSections.id,
      titleAr: contractSections.titleAr,
      titleEn: contractSections.titleEn,
      sortOrder: contractSections.sortOrder,
      sectionSubtotal: contractSections.sectionSubtotal,
      lineCount: sql<number>`count(${contractLines.id})::int`,
    })
    .from(contractSections)
    .leftJoin(contractLines, eq(contractLines.sectionId, contractSections.id))
    .where(eq(contractSections.contractId, contractId))
    .groupBy(contractSections.id)
    .orderBy(...SECTION_ORDER);
}

/** The contract's first LINES_PAGE_SIZE lines in document order, each with its section. */
function readOpeningLines(tx: MetraDb, contractId: string) {
  return tx
    .select({ ...LINE_VIEW_COLUMNS, sectionId: contractLines.sectionId })
    .from(contractLines)
    .innerJoin(contractSections, eq(contractSections.id, contractLines.sectionId))
    .where(eq(contractLines.contractId, contractId))
    .orderBy(...SECTION_ORDER, ...LINE_ORDER)
    .limit(LINES_PAGE_SIZE);
}

/**
 * Sections in order, each with its stored subtotal, its line count and the
 * lines it has inside the opening window: two queries, at most
 * LINES_PAGE_SIZE lines in all.
 */
export async function loadSectionSummaries(
  tx: MetraDb,
  contractId: string,
): Promise<ContractSectionSummary[]> {
  const sections = await readCountedSections(tx, contractId);
  const openingLines = await readOpeningLines(tx, contractId);
  const openingBySection = new Map<string, ContractLineView[]>();
  for (const { sectionId, ...line } of openingLines) {
    const existing = openingBySection.get(sectionId);
    if (existing) existing.push(line);
    else openingBySection.set(sectionId, [line]);
  }
  return sections.map((section) => ({
    ...section,
    openingLines: openingBySection.get(section.id) ?? [],
  }));
}
