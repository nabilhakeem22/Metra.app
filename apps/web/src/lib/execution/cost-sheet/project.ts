import 'server-only';
// What the project's Financials tab shows of job cost and margin (plan A5.3,
// replacing its two locked cards): the cost sheet of the project's execution
// contract, the newest one generated from a BOQ, a live one before a
// terminated one (the delivery card's rule, A26). Only its totals and its
// projected margin cross to the page, and the sheet is the same SQL aggregate
// the contract's Cost sheet tab reads.
import { contracts } from '@metra/db';
import { and, asc, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { getCostSheet } from './queries';

export interface ProjectCostSummary {
  contractId: string;
  budgetCost: string;
  actualCost: string;
  /** Null unless the reader may see margin. */
  projectedMargin: { value: string; pct: number | null } | null;
}

async function projectExecutionContractId(ctx: OrgContext, projectId: string): Promise<string | null> {
  const [row] = await withOrgContext(ctx, (tx) =>
    tx
      .select({ id: contracts.id })
      .from(contracts)
      .where(and(eq(contracts.projectId, projectId), isNotNull(contracts.sourceBoqId)))
      .orderBy(asc(sql`(${contracts.status} = 'terminated')`), desc(contracts.createdAt), desc(contracts.id))
      .limit(1),
  );
  return row?.id ?? null;
}

/** Null when the project has no execution contract yet. */
export async function getProjectCostSummary(
  ctx: OrgContext,
  projectId: string,
  canSeeMargin: boolean,
): Promise<ProjectCostSummary | null> {
  const contractId = await projectExecutionContractId(ctx, projectId);
  const sheet = contractId ? await getCostSheet(ctx, contractId, canSeeMargin) : null;
  if (!contractId || !sheet) return null;
  return {
    contractId,
    budgetCost: sheet.totals.budgetCost,
    actualCost: sheet.totals.actualCost,
    projectedMargin: sheet.margin && { value: sheet.margin.projected, pct: sheet.margin.projectedPct },
  };
}
