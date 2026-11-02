import 'server-only';
// What the project's BOQ tab renders from, read on the server. Split out of
// page.tsx so the tab's extra reads (what its Issue needs to know, the design-first
// gate of an issued BOQ) do not grow the page's composition.
import { getBoqIssueReadiness, projectHasLiveContractOnIssuedBoq } from '@/lib/boqs/issue';
import { getBoqTabDocument, type IssuedBoqVersion, type ProjectBoq } from '@/lib/boqs/queries';
import { getContractIdForBoq } from '@/lib/contracts/queries';
import type { OrgContext } from '@/lib/db/context';
import { withOrgContext } from '@/lib/db/context';
import { contractFromBoqRefusal } from '@/lib/engagements/design-first';
import { readExecutionGate } from '@/lib/engagements/pair-home';
import { can } from '@/lib/permissions/can';
import type { BoqExecution } from './boq-tab-sheet';

export async function loadBoqTab(ctx: OrgContext, projectId: string) {
  const canBuild = can(ctx.role, 'boq_build', 'create');
  const canSeeCost = can(ctx.role, 'margin_pnl', 'read');
  const { boq, issuedVersion } = await getBoqTabDocument(ctx, projectId, { showCost: canSeeCost, canBuild });
  // Only a draft the role may issue has an Issue to turn off, and a confirm to word.
  const issueReadiness =
    boq && canBuild && boq.status === 'draft'
      ? await getBoqIssueReadiness(ctx, boq.id)
      : { hasDelivery: true, clientCanOpen: false };
  const issueBlockedByContract =
    boq && canBuild && boq.status === 'draft'
      ? await withOrgContext(ctx, (tx) => projectHasLiveContractOnIssuedBoq(tx, projectId))
      : false;
  return {
    boq,
    canBuild,
    canSeeCost,
    clientCanOpenOnIssue: issueReadiness.clientCanOpen,
    issueNeedsDelivery: !issueReadiness.hasDelivery,
    issueBlockedByContract,
    execution: await loadBoqExecution(ctx, projectId, boq, issuedVersion),
  };
}

const NO_EXECUTION: BoqExecution = { contractId: null, canGenerate: false, refusal: null, canStartVersion: false };

/**
 * An issued BOQ becomes an execution contract: open the one it has, offer to
 * create it, or say why not yet; and, with no live contract at the pair's home,
 * it can be replaced. `version` is there for a role that builds BOQs, in place
 * of the contract lookup. The gate is read only with no live contract, so an
 * issued BOQ a contract stands on costs nothing more.
 */
async function loadBoqExecution(
  ctx: OrgContext,
  projectId: string,
  boq: ProjectBoq | null,
  version: IssuedBoqVersion | null,
): Promise<BoqExecution> {
  if (!boq || boq.status !== 'issued') return NO_EXECUTION;
  const mayOpenContract = can(ctx.role, 'contracts_generate', 'read');
  const canGenerate = can(ctx.role, 'contracts_generate', 'create');
  if (!version) return mayOpenContract ? { ...NO_EXECUTION, contractId: await getContractIdForBoq(ctx, boq.id), canGenerate } : NO_EXECUTION;
  const contractId = mayOpenContract ? version.contractId : null;
  if (version.contractIsLive) return { ...NO_EXECUTION, contractId, canGenerate };
  const gate = await withOrgContext(ctx, (tx) => readExecutionGate(tx, { projectId, clientId: boq.clientId }));
  return {
    contractId,
    canGenerate,
    refusal: canGenerate && contractId === null ? contractFromBoqRefusal(gate, boq) : null,
    canStartVersion: gate.kind === 'home',
  };
}
