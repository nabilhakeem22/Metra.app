import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { requireOrg } from '@/lib/auth/require-org';
import { mayRecordSignedOffline } from '@/lib/contracts/lifecycle';
import { getContractPage, getContractSectionsPage } from '@/lib/contracts/queries';
import { getContractSchedule } from '@/lib/contracts/schedule/queries';
import { mayReadCostEntries, mayRecordCostEntries } from '@/lib/execution/costs/access';
import { docYear, formatDocNumber } from '@/lib/format/doc-number';
import { resolveSeeMargin } from '@/lib/org/queries';
import { can } from '@/lib/permissions/can';
import { listVariations } from '@/lib/variations/queries';
import { ContractDetailClient } from './contract-detail-client';
import { contractTabsFor, openingContractTab } from './tabs';

export default async function ContractDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const ctx = await requireOrg();
  if (!can(ctx.role, 'contracts_generate', 'read')) notFound();
  const { id } = await params;

  const t = await getTranslations('contracts');
  const seeMargin = await resolveSeeMargin(ctx);
  const detail = await getContractPage(ctx, id, seeMargin);
  if (!detail) notFound();
  const variations = await listVariations(ctx, { contractId: id });
  // Only an execution contract has a schedule: at most 12 rows. Its costs are
  // asked by the Costs tab when it opens, so this page costs the same however
  // many the contract holds.
  const schedule = detail.sourceBoqId === null ? null : await getContractSchedule(ctx, detail);
  const tabs = contractTabsFor(detail, { readsCosts: mayReadCostEntries(ctx.role) });
  const openingTab = openingContractTab((await searchParams).tab, tabs);
  // Only the overview shows the sections: the schedule and the change orders
  // never read them (A3 reliability R1). Opened elsewhere, the overview asks
  // for its first page when it is shown.
  const openingSections = openingTab === 'overview' ? await getContractSectionsPage(ctx, id, null) : null;

  const canManage = can(ctx.role, 'contracts_generate', 'update');
  const canIssue = can(ctx.role, 'contracts_issue', 'approve');
  const canDraftVariation = can(ctx.role, 'variations_draft', 'create');
  const canPriceVariation = can(ctx.role, 'variations_price', 'approve');

  return (
    <div className="space-y-6">
      <PageHeader
        title={formatDocNumber('C', detail.number, docYear(null, detail.createdAt))}
        description={t(detail.sourceBoqId === null ? 'subtitle' : 'subtitleBoq')}
      />
      <ContractDetailClient
        detail={detail}
        openingSections={openingSections}
        variations={variations}
        schedule={schedule}
        tabs={tabs}
        openingTab={openingTab}
        canSignOffline={mayRecordSignedOffline(ctx.role)}
        canCreateCosts={mayRecordCostEntries(ctx.role)}
        canPickCostItem={can(ctx.role, 'proposals_build', 'update')}
        canManage={canManage}
        canIssue={canIssue}
        canDraftVariation={canDraftVariation}
        canPriceVariation={canPriceVariation}
      />
    </div>
  );
}
