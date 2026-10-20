import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { requireOrg } from '@/lib/auth/require-org';
import { getContractPage } from '@/lib/contracts/queries';
import { listCostEntries } from '@/lib/execution/costs/queries';
import { mayReadCostEntries } from '@/lib/execution/costs/reads';
import { NO_COST_FILTER } from '@/lib/execution/costs/types';
import { docYear, formatDocNumber } from '@/lib/format/doc-number';
import { resolveSeeMargin } from '@/lib/org/queries';
import { can } from '@/lib/permissions/can';
import { listVariations } from '@/lib/variations/queries';
import { ContractDetailClient } from './contract-detail-client';
import { contractTabsFor } from './tabs';

export default async function ContractDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requireOrg();
  if (!can(ctx.role, 'contracts_generate', 'read')) notFound();
  const { id } = await params;

  const t = await getTranslations('contracts');
  const seeMargin = await resolveSeeMargin(ctx);
  const detail = await getContractPage(ctx, id, seeMargin);
  if (!detail) notFound();
  const variations = await listVariations(ctx, { contractId: id });
  // Only an execution contract has costs: their first page (at most 50) and its total.
  const costs =
    detail.sourceBoqId !== null && mayReadCostEntries(ctx.role)
      ? await listCostEntries(ctx, { contractId: id, filter: NO_COST_FILTER, cursor: null })
      : null;

  const canManage = can(ctx.role, 'contracts_generate', 'update');
  const canIssue = can(ctx.role, 'contracts_issue', 'approve');
  const canDraftVariation = can(ctx.role, 'variations_draft', 'create');
  const canPriceVariation = can(ctx.role, 'variations_price', 'approve');

  return (
    <div className="space-y-6">
      <PageHeader
        title={formatDocNumber('C', detail.number, docYear(null, detail.createdAt))}
        description={t('subtitle')}
      />
      <ContractDetailClient
        detail={detail}
        variations={variations}
        costs={costs}
        tabs={contractTabsFor(costs !== null)}
        canCreateCosts={can(ctx.role, 'cost_entries', 'create')}
        canUpdateCosts={can(ctx.role, 'cost_entries', 'update')}
        canManage={canManage}
        canIssue={canIssue}
        canDraftVariation={canDraftVariation}
        canPriceVariation={canPriceVariation}
      />
    </div>
  );
}
