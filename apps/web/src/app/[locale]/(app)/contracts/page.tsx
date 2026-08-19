import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { requireOrg } from '@/lib/auth/require-org';
import { getContractedProposalIds, listContracts } from '@/lib/contracts/queries';
import { can } from '@/lib/permissions/can';
import { listProposals } from '@/lib/proposals/queries';
import { ContractsClient } from './contracts-client';

export default async function ContractsPage() {
  const ctx = await requireOrg();
  if (!can(ctx.role, 'contracts_generate', 'read')) notFound();

  const t = await getTranslations('contracts');
  const [rows, acceptedProposals] = await Promise.all([
    listContracts(ctx, {}),
    listProposals(ctx, { status: 'accepted' }),
  ]);
  const contracted = await getContractedProposalIds(
    ctx,
    acceptedProposals.map((p) => p.id),
  );
  const generatable = acceptedProposals
    .filter((p) => !contracted.has(p.id))
    .map((p) => ({
      id: p.id,
      number: p.number,
      titleAr: p.titleAr,
      titleEn: p.titleEn,
      issueDate: p.issueDate,
      createdAt: p.createdAt,
    }));
  const canManage = can(ctx.role, 'contracts_generate', 'create');

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('subtitle')} />
      <ContractsClient
        items={rows}
        generatable={generatable}
        canManage={canManage}
      />
    </div>
  );
}
