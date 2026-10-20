import 'server-only';
// What the project's BOQ tab renders from, read on the server. Split out of
// page.tsx so the tab's one extra read (the release rule its Issue confirm
// states) does not grow the page's composition.
import { getBoqIssueReleasable } from '@/lib/boqs/issue';
import { getProjectBoq } from '@/lib/boqs/queries';
import { getContractIdForBoq } from '@/lib/contracts/queries';
import type { OrgContext } from '@/lib/db/context';
import { can } from '@/lib/permissions/can';
import type { BoqExecution } from './boq-tab-sheet';

export async function loadBoqTab(ctx: OrgContext, projectId: string) {
  const canBuild = can(ctx.role, 'boq_build', 'create');
  const canSeeCost = can(ctx.role, 'margin_pnl', 'read');
  const boq = await getProjectBoq(ctx, projectId, { showCost: canSeeCost });
  // Only a draft the role may issue has an Issue confirm to word.
  const clientCanOpenOnIssue =
    boq && canBuild && boq.status === 'draft'
      ? await getBoqIssueReleasable(ctx, boq.id)
      : false;
  return { boq, canBuild, canSeeCost, clientCanOpenOnIssue, execution: await loadBoqExecution(ctx, boq) };
}

/** An issued BOQ becomes an execution contract: open the one it has, or offer to create it. */
async function loadBoqExecution(ctx: OrgContext, boq: { id: string; status: string } | null): Promise<BoqExecution> {
  if (!boq || boq.status !== 'issued' || !can(ctx.role, 'contracts_generate', 'read')) {
    return { contractId: null, canGenerate: false };
  }
  return {
    contractId: await getContractIdForBoq(ctx, boq.id),
    canGenerate: can(ctx.role, 'contracts_generate', 'create'),
  };
}
