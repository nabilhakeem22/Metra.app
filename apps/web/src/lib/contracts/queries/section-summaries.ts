import 'server-only';
// The contract page's sections, a page of SECTIONS_PAGE_SIZE at a time (A3
// reliability R1): each with its stored subtotal and its line count, counted in
// SQL for that page's sections only. The FIRST page also carries the opening
// window, the first LINES_PAGE_SIZE lines of the contract in document order, so
// the page costs the same for 20 sections or 2,000, and 20 lines or 2,000. A
// later page's sections open collapsed; their lines load on demand through
// ./section-lines.ts. Keyset on (sort_order, id), read off the cursor section
// itself, so a page never skips or repeats a section.
import { contractLines, contractSections, type MetraDb } from '@metra/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import type { ContractLineView, ContractSectionsPage } from './detail-types';
import { isKnownSectionCursor } from './line-positions';
import { LINE_ORDER, LINE_VIEW_COLUMNS, LINES_PAGE_SIZE, SECTION_ORDER, SECTIONS_PAGE_SIZE } from './line-view';

/** Sections past the cursor section. A cursor that is not a section of this contract matches nothing. */
function pastSection(contractId: string, afterSectionId: string) {
  return sql`(${contractSections.sortOrder}, ${contractSections.id}) > (
    select cursor_section.sort_order, cursor_section.id
    from ${contractSections} as cursor_section
    where cursor_section.id = ${afterSectionId} and cursor_section.contract_id = ${contractId}
  )`;
}

/** One page of sections, plus one more to know whether another page follows. */
function readSections(tx: MetraDb, contractId: string, afterSectionId: string | null) {
  return tx
    .select({
      id: contractSections.id,
      titleAr: contractSections.titleAr,
      titleEn: contractSections.titleEn,
      sortOrder: contractSections.sortOrder,
      sectionSubtotal: contractSections.sectionSubtotal,
    })
    .from(contractSections)
    .where(
      and(
        eq(contractSections.contractId, contractId),
        afterSectionId ? pastSection(contractId, afterSectionId) : undefined,
      ),
    )
    .orderBy(...SECTION_ORDER)
    .limit(SECTIONS_PAGE_SIZE + 1);
}

/** The line count of each of these sections, in one GROUP BY. */
async function countLines(tx: MetraDb, sectionIds: string[]): Promise<Map<string, number>> {
  if (sectionIds.length === 0) return new Map();
  const rows = await tx
    .select({ sectionId: contractLines.sectionId, count: sql<number>`count(*)::int` })
    .from(contractLines)
    .where(inArray(contractLines.sectionId, sectionIds))
    .groupBy(contractLines.sectionId);
  return new Map(rows.map((row) => [row.sectionId, row.count]));
}

/** The contract's first LINES_PAGE_SIZE lines among these sections, in document order, by section. */
async function readOpeningLines(
  tx: MetraDb,
  contractId: string,
  sectionIds: string[],
): Promise<Map<string, ContractLineView[]>> {
  const bySection = new Map<string, ContractLineView[]>();
  if (sectionIds.length === 0) return bySection;
  const rows = await tx
    .select({ ...LINE_VIEW_COLUMNS, sectionId: contractLines.sectionId })
    .from(contractLines)
    .innerJoin(contractSections, eq(contractSections.id, contractLines.sectionId))
    .where(and(eq(contractLines.contractId, contractId), inArray(contractLines.sectionId, sectionIds)))
    .orderBy(...SECTION_ORDER, ...LINE_ORDER)
    .limit(LINES_PAGE_SIZE);
  for (const { sectionId, ...line } of rows) {
    const existing = bySection.get(sectionId);
    if (existing) existing.push(line);
    else bySection.set(sectionId, [line]);
  }
  return bySection;
}

/**
 * The page of sections after `afterSectionId` (the first page for null), each
 * with its line count; the first page with the opening lines too. Three
 * queries, at most SECTIONS_PAGE_SIZE sections and LINES_PAGE_SIZE lines.
 */
async function loadSectionsPage(
  tx: MetraDb,
  contractId: string,
  afterSectionId: string | null,
): Promise<ContractSectionsPage> {
  const read = await readSections(tx, contractId, afterSectionId);
  const sections = read.slice(0, SECTIONS_PAGE_SIZE);
  const ids = sections.map((section) => section.id);
  const counts = await countLines(tx, ids);
  const opening = afterSectionId === null ? await readOpeningLines(tx, contractId, ids) : new Map<string, ContractLineView[]>();
  return {
    sections: sections.map((section) => ({
      ...section,
      lineCount: counts.get(section.id) ?? 0,
      openingLines: opening.get(section.id) ?? [],
    })),
    hasMore: read.length > SECTIONS_PAGE_SIZE,
  };
}

/**
 * A page of the contract's sections for the contract page. Null when the
 * contract, or the cursor section, is not the caller's to see or does not
 * exist (row-level security): asked only when the page comes back empty.
 */
export function getContractSectionsPage(
  ctx: OrgContext,
  contractId: string,
  afterSectionId: string | null,
): Promise<ContractSectionsPage | null> {
  return withOrgContext(ctx, async (tx) => {
    const page = await loadSectionsPage(tx, contractId, afterSectionId);
    if (page.sections.length === 0 && !(await isKnownSectionCursor(tx, { contractId, afterSectionId }))) return null;
    return page;
  });
}
