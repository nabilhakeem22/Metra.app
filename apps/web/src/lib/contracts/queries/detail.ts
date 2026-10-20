import 'server-only';
// The contract, margin-gated, in its two shapes: the PAGE (the header and how
// it was signed; its sections load a page at a time through
// ./section-summaries.ts, their lines through ./section-lines.ts) and the PDF
// (every line, because the printed document is the whole contract).
// Both share one header assembly: load the header (./detail-header.ts), compute
// the revised value and the days approved change orders add, gate the margin.
import { variationOrders, type MetraDb } from '@metra/db';
import { and, eq, sql } from 'drizzle-orm';
import { computeRevisedContractValue } from '@/lib/aggregates/contract-value';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { loadContractHeader } from './detail-header';
import { loadContractSections } from './detail-sections';
import type { ContractDetail, ContractHeaderDetail, ContractPageDetail } from './detail-types';
import { loadContractSigning } from './signing';

export type {
  ContractDetail,
  ContractDetailLine,
  ContractDetailSection,
  ContractHeaderDetail,
  ContractLineOption,
  ContractLineOptionsPage,
  ContractLinesPage,
  ContractLineView,
  ContractPageDetail,
  ContractSectionsPage,
  ContractSectionSummary,
  ContractSigning,
} from './detail-types';

/**
 * What the APPROVED VOs change, summed in SQL (one row, however many orders):
 * revised value = original + Σ netDelta (A3, computed), and the days they add
 * to the finish date (A24). numeric sums exactly, so the BigInt engine adds one
 * figure instead of every order's.
 */
async function computeApprovedChanges(
  tx: MetraDb,
  contractId: string,
  originalValue: string,
): Promise<{ revisedValue: string; approvedExtensionDays: number }> {
  const [approved] = await tx
    .select({
      netDelta: sql<string>`coalesce(sum(${variationOrders.netDelta}), 0)::text`,
      extensionDays: sql<number>`coalesce(sum(${variationOrders.timeExtensionDays}), 0)::int`,
    })
    .from(variationOrders)
    .where(
      and(
        eq(variationOrders.contractId, contractId),
        eq(variationOrders.status, 'approved'),
      ),
    );
  return {
    revisedValue: computeRevisedContractValue(originalValue, [approved.netDelta]),
    approvedExtensionDays: approved.extensionDays,
  };
}

/** The header, the revised value, and cost totals only when the caller may see margin. */
async function loadHeaderDetail(
  tx: MetraDb,
  id: string,
  canSeeMargin: boolean,
): Promise<ContractHeaderDetail | null> {
  const header = await loadContractHeader(tx, id);
  if (!header) return null;

  const { createdAt, totalCost, totalMargin, ...rest } = header;
  return {
    ...rest,
    createdAt: createdAt.toISOString(),
    ...(await computeApprovedChanges(tx, id, header.originalValue)),
    // Absent, not null, when the caller may not see margin.
    ...(canSeeMargin ? { totalCost, totalMargin } : {}),
  };
}

/** The contract page's read: the header and how it was signed, whatever the contract's size. */
export function getContractPage(
  ctx: OrgContext,
  id: string,
  canSeeMargin: boolean,
): Promise<ContractPageDetail | null> {
  return withOrgContext(ctx, async (tx) => {
    const header = await loadHeaderDetail(tx, id, canSeeMargin);
    if (!header) return null;
    return { ...header, signed: await loadContractSigning(tx, id) };
  });
}

/** The PDF's read: every section and every line. */
export function getContractForPdf(
  ctx: OrgContext,
  id: string,
  canSeeMargin: boolean,
): Promise<ContractDetail | null> {
  return withOrgContext(ctx, async (tx) => {
    const header = await loadHeaderDetail(tx, id, canSeeMargin);
    if (!header) return null;
    return { ...header, sections: await loadContractSections(tx, id, canSeeMargin) };
  });
}
