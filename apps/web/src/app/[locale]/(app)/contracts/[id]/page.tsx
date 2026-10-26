import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { requireOrg } from '@/lib/auth/require-org';
import { mayRecordSignedOffline } from '@/lib/contracts/lifecycle';
import { getContractPage, getContractSectionsPage } from '@/lib/contracts/queries';
import { mayIssueRequests, mayRecordPayments, maySeeBilling } from '@/lib/execution/billing/access';
import { mayOpenCostSheet } from '@/lib/execution/cost-sheet/access';
import { mayReadCostEntries, mayRecordCostEntries } from '@/lib/execution/costs/access';
import { mayReadMeasurements, mayRecordMeasurements } from '@/lib/execution/measurements/access';
import { getContractPageExecution } from '@/lib/execution/queries/facts';
import { docYear, formatDocNumber } from '@/lib/format/doc-number';
import { resolveSeeMargin } from '@/lib/org/queries';
import { can } from '@/lib/permissions/can';
import { mayRecordVariationDecisionOnPaper } from '@/lib/variations/paper-access';
import { listVariations } from '@/lib/variations/queries';
import { isUuid } from '@/lib/uuid';
import { ContractDetailClient } from './contract-detail-client';
import { contractPagePayload } from './page-payload';
import { contractSubtitle } from './subtitle';
import { contractTabsFor, openingContractTab } from './tabs';

export default async function ContractDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const ctx = await requireOrg();
  const access = {
    seeContract: can(ctx.role, 'contracts_generate', 'read'),
    seeBilling: maySeeBilling(ctx.role),
    seeMeasurements: mayReadMeasurements(ctx.role),
    readsCosts: mayReadCostEntries(ctx.role),
    seeCostSheet: mayOpenCostSheet(ctx.role),
    decidesVariationsOnPaper: mayRecordVariationDecisionOnPaper(ctx.role),
  };
  if (!access.seeContract && !access.seeBilling) notFound();
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const t = await getTranslations('contracts');
  const seeMargin = await resolveSeeMargin(ctx);
  const detail = await getContractPage(ctx, id, seeMargin);
  if (!detail) notFound();
  const tabs = contractTabsFor(detail, access);
  // A proposal contract has no execution tab: nothing on it is a billing role's,
  // and only its change orders are a project manager's.
  if (tabs.length === 0) notFound();
  const variations = tabs.includes('variations') ? await listVariations(ctx, { contractId: id }) : [];
  // Only an execution contract has a schedule (at most 12 rows) and, once
  // signed, a stage beyond its status to tell: one read for both. Its costs are
  // asked by the Costs tab when it opens, so this page costs the same however
  // many the contract holds.
  const execution =
    detail.sourceBoqId !== null ? await getContractPageExecution(ctx, detail, { schedule: tabs.includes('schedule') }) : null;
  const schedule = execution?.schedule ?? null;
  const openingTab = openingContractTab((await searchParams).tab, tabs);
  // Only the overview shows the sections: the schedule and the change orders
  // never read them (A3 reliability R1). Opened elsewhere, the overview asks
  // for its first page when it is shown.
  const openingSections = openingTab === 'overview' ? await getContractSectionsPage(ctx, id, null) : null;

  const canManage = can(ctx.role, 'contracts_generate', 'update');
  const canIssue = can(ctx.role, 'contracts_issue', 'approve');
  // Drafting picks the contract's own lines, so it needs the contract itself:
  // a project manager reads the register for its paper answers alone.
  const canDraftVariation = access.seeContract && can(ctx.role, 'variations_draft', 'create');
  const canPriceVariation = can(ctx.role, 'variations_price', 'approve');

  return (
    <div className="space-y-6">
      <PageHeader
        title={formatDocNumber('C', detail.number, docYear(null, detail.createdAt))}
        description={t(`detailSubtitle.${contractSubtitle(detail, execution?.stage ?? null)}`)}
      />
      <ContractDetailClient
        {...contractPagePayload(detail, { seeContract: access.seeContract, seeRegister: tabs.includes('variations') })}
        openingSections={openingSections}
        variations={variations}
        schedule={schedule}
        executionMay={{ issue: mayIssueRequests(ctx.role), record: mayRecordPayments(ctx.role), measure: mayRecordMeasurements(ctx.role) }}
        tabs={tabs}
        openingTab={openingTab}
        canSignOffline={mayRecordSignedOffline(ctx.role)}
        canCreateCosts={mayRecordCostEntries(ctx.role)}
        canPickCostItem={can(ctx.role, 'proposals_build', 'update')}
        canManage={canManage}
        canIssue={canIssue}
        canDraftVariation={canDraftVariation}
        canPriceVariation={canPriceVariation}
        canDecideVariationOnPaper={access.decidesVariationsOnPaper}
      />
    </div>
  );
}
