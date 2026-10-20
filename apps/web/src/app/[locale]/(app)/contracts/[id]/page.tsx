import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { requireOrg } from '@/lib/auth/require-org';
import { mayRecordSignedOffline } from '@/lib/contracts/lifecycle';
import { getContractPage, getContractSectionsPage } from '@/lib/contracts/queries';
import { getContractSchedule } from '@/lib/contracts/schedule/queries';
import { mayIssueRequests, mayRecordPayments, maySeeBilling } from '@/lib/execution/billing/access';
import { docYear, formatDocNumber } from '@/lib/format/doc-number';
import { resolveSeeMargin } from '@/lib/org/queries';
import { can } from '@/lib/permissions/can';
import { listVariations } from '@/lib/variations/queries';
import { ContractDetailClient } from './contract-detail-client';
import { contractPagePayload } from './page-payload';
import { contractTabsFor, openingContractTab } from './tabs';

export default async function ContractDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const ctx = await requireOrg();
  const access = { seeContract: can(ctx.role, 'contracts_generate', 'read'), seeBilling: maySeeBilling(ctx.role) };
  if (!access.seeContract && !access.seeBilling) notFound();
  const { id } = await params;

  const t = await getTranslations('contracts');
  const seeMargin = await resolveSeeMargin(ctx);
  const detail = await getContractPage(ctx, id, seeMargin);
  if (!detail) notFound();
  const tabs = contractTabsFor(detail, access);
  // A proposal contract has no Payments tab: nothing on it is a billing role's.
  if (tabs.length === 0) notFound();
  const variations = tabs.includes('variations') ? await listVariations(ctx, { contractId: id }) : [];
  // Only an execution contract has a schedule: at most 12 rows.
  const schedule = tabs.includes('schedule') ? await getContractSchedule(ctx, detail) : null;
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
        {...contractPagePayload(detail, access)}
        openingSections={openingSections}
        variations={variations}
        schedule={schedule}
        billingMay={{ issue: mayIssueRequests(ctx.role), record: mayRecordPayments(ctx.role) }}
        tabs={tabs}
        openingTab={openingTab}
        canSignOffline={mayRecordSignedOffline(ctx.role)}
        canManage={canManage}
        canIssue={canIssue}
        canDraftVariation={canDraftVariation}
        canPriceVariation={canPriceVariation}
      />
    </div>
  );
}
