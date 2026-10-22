import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { TablePager } from '@/components/ui/table-pager';
import { requireOrg } from '@/lib/auth/require-org';
import { getContractedProposalIds, listContractsPage } from '@/lib/contracts/queries';
import { can } from '@/lib/permissions/can';
import { listProposals } from '@/lib/proposals/queries';
import { REGISTER_PAGE_SIZE, readRegisterView, registerViewSearch } from '@/lib/registers/register-view';
import { ContractsClient } from './contracts-client';

export default async function ContractsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireOrg();
  if (!can(ctx.role, 'contracts_generate', 'read')) notFound();

  const { page: requestedPage } = readRegisterView(await searchParams);
  const t = await getTranslations('contracts');
  const [register, acceptedProposals] = await Promise.all([
    listContractsPage(ctx, { page: requestedPage }),
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
        items={register.rows}
        generatable={generatable}
        canManage={canManage}
        pager={
          <TablePager
            page={register.page}
            pageSize={REGISTER_PAGE_SIZE}
            total={register.total}
            hrefFor={(page) => `/contracts${registerViewSearch({ query: '', page })}`}
            label={t('pagerLabel')}
          />
        }
      />
    </div>
  );
}
