import 'server-only';
// What the project's Financials tab shows of job cost and margin (plan A5.3,
// replacing its two locked cards): the cost sheet of the project's execution
// contract, the newest one generated from a BOQ, a live one before a
// terminated one (the delivery card's rule, A26). Only its totals, its
// projected margin and its billing cross to the page, and the sheet is the
// same SQL aggregate the contract's Cost sheet tab reads. A reader who may not
// see margin gets the billing only, as on that tab (A5 fix round, F10 and S1).
import { contracts } from '@metra/db';
import { and, asc, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { getCostSheet } from './queries';

export interface ProjectCostSummary {
  contractId: string;
  billing: { requested: string; paid: string; outstanding: string };
  /** Null unless the reader may see cost and margin. */
  cost: null | { budgetCost: string; actualCost: string; projectedMargin: { value: string; pct: number | null } };
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
    billing: sheet.billing,
    cost: sheet.cost && {
      budgetCost: sheet.cost.totals.budgetCost,
      actualCost: sheet.cost.totals.actualCost,
      projectedMargin: { value: sheet.cost.margin.projected, pct: sheet.cost.margin.projectedPct },
    },
  };
}
