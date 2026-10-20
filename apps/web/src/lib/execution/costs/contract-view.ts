import 'server-only';
// What the cost surfaces read of the contract itself, for a role that may read
// its costs but not open the contract page (lead ruling on PR B3, F1): the
// header the costs page shows, and the sections a cost is booked to or
// filtered by. NO MONEY: no value, no subtotal, no margin, no line price.
import { clients, contractSections, contracts } from '@metra/db';
import { and, eq, sql } from 'drizzle-orm';
import { isKnownSectionCursor } from '@/lib/contracts/queries/line-positions';
import { SECTION_ORDER, SECTIONS_PAGE_SIZE } from '@/lib/contracts/queries/line-view';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import type { CostContractHeader, CostSectionsPage } from './types';

/**
 * The costs page's header: number, title, client and status. Null when the
 * contract is not the caller's to see (RLS, or no such id) or is not an
 * execution contract (from a BOQ), which has no costs.
 */
export function getCostContractHeader(ctx: OrgContext, contractId: string): Promise<CostContractHeader | null> {
  return withOrgContext(ctx, async (tx) => {
    const [row] = await tx
      .select({
        id: contracts.id,
        number: contracts.number,
        createdAt: contracts.createdAt,
        titleAr: contracts.titleAr,
        titleEn: contracts.titleEn,
        status: contracts.status,
        sourceBoqId: contracts.sourceBoqId,
        clientNameAr: clients.nameAr,
        clientNameEn: clients.nameEn,
      })
      .from(contracts)
      .leftJoin(clients, eq(clients.id, contracts.clientId))
      .where(eq(contracts.id, contractId))
      .limit(1);
    if (!row || row.sourceBoqId === null) return null;
    const { sourceBoqId: _execution, createdAt, ...header } = row;
    return { ...header, createdAt: createdAt.toISOString() };
  });
}

/**
 * The contract's sections after `afterSectionId` (the first ones for null),
 * SECTIONS_PAGE_SIZE at a time in document order: id and titles only. Null
 * when the contract, or the cursor section, is not the caller's to see.
 */
export function listCostSections(
  ctx: OrgContext,
  contractId: string,
  afterSectionId: string | null,
): Promise<CostSectionsPage | null> {
  return withOrgContext(ctx, async (tx) => {
    const rows = await tx
      .select({ id: contractSections.id, titleAr: contractSections.titleAr, titleEn: contractSections.titleEn })
      .from(contractSections)
      .where(
        and(
          eq(contractSections.contractId, contractId),
          afterSectionId
            ? sql`(${contractSections.sortOrder}, ${contractSections.id}) > (
                select cursor_section.sort_order, cursor_section.id from ${contractSections} as cursor_section
                where cursor_section.id = ${afterSectionId} and cursor_section.contract_id = ${contractId})`
            : undefined,
        ),
      )
      .orderBy(...SECTION_ORDER)
      .limit(SECTIONS_PAGE_SIZE + 1);
    if (rows.length === 0 && !(await isKnownSectionCursor(tx, { contractId, afterSectionId }))) return null;
    return { sections: rows.slice(0, SECTIONS_PAGE_SIZE), hasMore: rows.length > SECTIONS_PAGE_SIZE };
  });
}
