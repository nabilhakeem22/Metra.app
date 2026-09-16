import 'server-only';
// The full contract, margin-gated: header, sections with their lines, and the
// revised value. Four named phases — load the header (./detail-header.ts), load
// the sections, compute the revised value, assemble — rather than one 174-line
// function.
import { variationOrders, type MetraDb } from '@metra/db';
import { and, eq } from 'drizzle-orm';
import { computeRevisedContractValue } from '@/lib/aggregates/contract-value';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { loadContractHeader } from './detail-header';
import { loadContractSections } from './detail-sections';
import type { ContractDetail } from './detail-types';

export type {
  ContractDetail,
  ContractDetailLine,
  ContractDetailSection,
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

async function loadDetail(
  ctx: OrgContext,
  id: string,
  canSeeMargin: boolean,
): Promise<ContractDetail | null> {
  return withOrgContext(ctx, async (tx) => {
    const header = await loadContractHeader(tx, id);
    if (!header) return null;

    const { createdAt, totalCost, totalMargin, ...rest } = header;
    return {
      ...rest,
      createdAt: createdAt.toISOString(),
      sections: await loadContractSections(tx, id, canSeeMargin),
      revisedValue: await computeRevisedValue(tx, id, header.originalValue),
      // Absent, not null, when the caller may not see margin.
      ...(canSeeMargin ? { totalCost, totalMargin } : {}),
    };
  });
}

export function getContractWithLines(
  ctx: OrgContext,
  id: string,
  canSeeMargin: boolean,
): Promise<ContractDetail | null> {
  return loadDetail(ctx, id, canSeeMargin);
}

export function getContractForPdf(
  ctx: OrgContext,
  id: string,
  canSeeMargin: boolean,
): Promise<ContractDetail | null> {
  return loadDetail(ctx, id, canSeeMargin);
}
