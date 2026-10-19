import 'server-only';
// One section's lines, a page at a time: the contract page's "show lines".
// Keyset on (sort_order, id), read off the cursor line itself, so a page never
// skips or repeats a line and costs the same deep in a 2,000-line section as at
// its top.
import { contractLines } from '@metra/db';
import { and, eq, sql } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import type { ContractLinesPage } from './detail-types';
import { isKnownSectionPosition } from './line-positions';
import { LINE_ORDER, LINE_VIEW_COLUMNS, LINES_PAGE_SIZE } from './line-view';

export interface SectionLinesRequest {
  contractId: string;
  sectionId: string;
  /** The last line already shown; null for the section's first page. */
  afterLineId: string | null;
}

/** Lines past the cursor line. A cursor that is not a line of this section matches nothing. */
function pastCursor(sectionId: string, afterLineId: string) {
  return sql`(${contractLines.sortOrder}, ${contractLines.id}) > (
    select cursor_line.sort_order, cursor_line.id
    from ${contractLines} as cursor_line
    where cursor_line.id = ${afterLineId} and cursor_line.section_id = ${sectionId}
  )`;
}

/**
 * At most LINES_PAGE_SIZE lines of one section of one contract, in order, and
 * whether more follow. Null when the section is not one of the contract's, the
 * cursor not one of the section's lines, or either is another studio's
 * (row-level security): asked only when the page comes back empty.
 */
export function listSectionLines(
  ctx: OrgContext,
  request: SectionLinesRequest,
): Promise<ContractLinesPage | null> {
  return withOrgContext(ctx, async (tx) => {
    const rows = await tx
      .select(LINE_VIEW_COLUMNS)
      .from(contractLines)
      .where(
        and(
          eq(contractLines.contractId, request.contractId),
          eq(contractLines.sectionId, request.sectionId),
          request.afterLineId ? pastCursor(request.sectionId, request.afterLineId) : undefined,
        ),
      )
      .orderBy(...LINE_ORDER)
      .limit(LINES_PAGE_SIZE + 1);
    if (rows.length === 0 && !(await isKnownSectionPosition(tx, request))) return null;
    return { lines: rows.slice(0, LINES_PAGE_SIZE), hasMore: rows.length > LINES_PAGE_SIZE };
  });
}
