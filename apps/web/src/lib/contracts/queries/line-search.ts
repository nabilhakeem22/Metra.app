import 'server-only';
// The variation form's baseline-line picker: a contract's lines found by a word
// of their description, at most LINES_PAGE_SIZE per answer, so the picker never
// needs the whole contract in the page.
import { contractLines, contractSections } from '@metra/db';
import { and, eq, ilike, or } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import type { ContractLinesPage } from './detail-types';
import { LINE_ORDER, LINE_VIEW_COLUMNS, LINES_PAGE_SIZE, SECTION_ORDER } from './line-view';

export interface LineSearchRequest {
  contractId: string;
  /** Matched anywhere in either description; empty lists the contract's first lines. */
  query: string;
}

/** `query` as an ILIKE pattern that matches it literally: % and _ are not wildcards here. */
function anywhere(query: string): string {
  return `%${query.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

/** The matching lines in document order, and whether more matched than were returned. */
export function searchContractLines(
  ctx: OrgContext,
  request: LineSearchRequest,
): Promise<ContractLinesPage> {
  return withOrgContext(ctx, async (tx) => {
    const query = request.query.trim();
    const pattern = anywhere(query);
    const rows = await tx
      .select(LINE_VIEW_COLUMNS)
      .from(contractLines)
      .innerJoin(contractSections, eq(contractSections.id, contractLines.sectionId))
      .where(
        and(
          eq(contractLines.contractId, request.contractId),
          query
            ? or(ilike(contractLines.descriptionAr, pattern), ilike(contractLines.descriptionEn, pattern))
            : undefined,
        ),
      )
      .orderBy(...SECTION_ORDER, ...LINE_ORDER)
      .limit(LINES_PAGE_SIZE + 1);
    return { lines: rows.slice(0, LINES_PAGE_SIZE), hasMore: rows.length > LINES_PAGE_SIZE };
  });
}
