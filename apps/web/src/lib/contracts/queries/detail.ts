import 'server-only';
// The contract, margin-gated, in its two shapes: the PAGE (sections counted in
// SQL, at most 50 lines; the rest load per section through ./section-lines.ts)
// and the PDF (every line, because the printed document is the whole contract).
// Both share one header assembly: load the header (./detail-header.ts), compute
// the revised value, gate the margin.
import { variationOrders, type MetraDb } from '@metra/db';
import { and, eq } from 'drizzle-orm';
import { computeRevisedContractValue } from '@/lib/aggregates/contract-value';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { loadContractHeader } from './detail-header';
import { loadContractSections } from './detail-sections';
import type { ContractDetail, ContractHeaderDetail, ContractPageDetail } from './detail-types';
import { loadSectionSummaries } from './section-summaries';

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
  ContractSectionSummary,
} from './detail-types';

/** Revised value = original + Σ netDelta of APPROVED VOs (A3, computed). */
async function computeRevisedValue(
  tx: MetraDb,
  contractId: string,
  originalValue: string,
): Promise<string> {
  const approved = await tx
    .select({ netDelta: variationOrders.netDelta })
    .from(variationOrders)
    .where(
      and(
        eq(variationOrders.contractId, contractId),
        eq(variationOrders.status, 'approved'),
      ),
    );
  return computeRevisedContractValue(
    originalValue,
    approved.map((variation) => variation.netDelta),
  );
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
    revisedValue: await computeRevisedValue(tx, id, header.originalValue),
    // Absent, not null, when the caller may not see margin.
    ...(canSeeMargin ? { totalCost, totalMargin } : {}),
  };
}

/** The contract page's read: bounded however many lines the contract holds. */
export function getContractPage(
  ctx: OrgContext,
  id: string,
  canSeeMargin: boolean,
): Promise<ContractPageDetail | null> {
  return withOrgContext(ctx, async (tx) => {
    const header = await loadHeaderDetail(tx, id, canSeeMargin);
    if (!header) return null;
    return { ...header, sections: await loadSectionSummaries(tx, id) };
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
