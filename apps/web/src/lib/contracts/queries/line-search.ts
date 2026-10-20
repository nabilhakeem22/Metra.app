import 'server-only';
// The variation form's baseline-line picker: a contract's lines found by every
// typed word, folded as every search in the app folds (lib/search), anywhere in
// the line's description or its section's title. At most LINES_PAGE_SIZE per
// answer, paged on in document order, so every line is reachable and the
// picker never needs the whole contract in the page.
import { contractLines, contractSections } from '@metra/db';
import { and, eq, sql } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { everyWordSql } from '@/lib/search/words-sql';
import type { ContractLineOptionsPage } from './detail-types';
import { isKnownContractPosition } from './line-positions';
import { LINE_ORDER, LINES_PAGE_SIZE, SECTION_ORDER } from './line-view';

export interface LineSearchRequest {
  contractId: string;
  /** Every word must match; empty lists the contract's lines from the start. */
  query: string;
  /** The last line of the previous answer for the same query; null for the first. */
  afterLineId: string | null;
}

const OPTION_COLUMNS = {
  id: contractLines.id,
  sectionId: contractLines.sectionId,
  descriptionAr: contractLines.descriptionAr,
  descriptionEn: contractLines.descriptionEn,
  sectionTitleAr: contractSections.titleAr,
  sectionTitleEn: contractSections.titleEn,
} as const;

/** What a word may match: the line's description and its section's title, in both languages. */
const LINE_AND_SECTION_TEXT = sql`concat_ws(' ', ${contractLines.descriptionAr}, ${contractLines.descriptionEn}, ${contractSections.titleAr}, ${contractSections.titleEn})`;

/** Lines after the cursor line in document order. A cursor outside the contract matches nothing. */
function pastCursor(contractId: string, afterLineId: string) {
  return sql`(${contractSections.sortOrder}, ${contractSections.id}, ${contractLines.sortOrder}, ${contractLines.id}) > (
    select cursor_section.sort_order, cursor_section.id, cursor_line.sort_order, cursor_line.id
    from ${contractLines} as cursor_line
    join ${contractSections} as cursor_section on cursor_section.id = cursor_line.section_id
    where cursor_line.id = ${afterLineId} and cursor_line.contract_id = ${contractId}
  )`;
}

/**
 * The matching lines in document order and whether more matched after them.
 * Null when the contract, or the cursor line, is not the caller's to see
 * (asked only when the answer comes back empty).
 */
export function searchContractLines(
  ctx: OrgContext,
  request: LineSearchRequest,
): Promise<ContractLineOptionsPage | null> {
  return withOrgContext(ctx, async (tx) => {
    const rows = await tx
      .select(OPTION_COLUMNS)
      .from(contractLines)
      .innerJoin(contractSections, eq(contractSections.id, contractLines.sectionId))
      .where(
        and(
          eq(contractLines.contractId, request.contractId),
          everyWordSql(LINE_AND_SECTION_TEXT, request.query),
          request.afterLineId ? pastCursor(request.contractId, request.afterLineId) : undefined,
        ),
      )
      .orderBy(...SECTION_ORDER, ...LINE_ORDER)
      .limit(LINES_PAGE_SIZE + 1);
    if (rows.length === 0 && !(await isKnownContractPosition(tx, request))) return null;
    return { lines: rows.slice(0, LINES_PAGE_SIZE), hasMore: rows.length > LINES_PAGE_SIZE };
  });
}
