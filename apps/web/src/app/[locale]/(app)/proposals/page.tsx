import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { TablePager } from '@/components/ui/table-pager';
import { requireOrg } from '@/lib/auth/require-org';
import { getClientOptions } from '@/lib/clients/queries';
import { can } from '@/lib/permissions/can';
import { listProposalsPage } from '@/lib/proposals/queries';
import { REGISTER_PAGE_SIZE, readRegisterView, registerViewSearch } from '@/lib/registers/register-view';
import { ProposalsClient } from './proposals-client';

export default async function ProposalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireOrg();
  if (!can(ctx.role, 'proposals_build', 'read')) notFound();

  const view = readRegisterView(await searchParams);
  const t = await getTranslations('proposals');
  const [register, clientOptions] = await Promise.all([
    listProposalsPage(ctx, { q: view.query, page: view.page }),
    getClientOptions(ctx),
  ]);
  const canManage = can(ctx.role, 'proposals_build', 'create');

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('subtitle')} />
      <ProposalsClient
        items={register.rows}
        hasAnyProposal={register.hasAnyProposal}
        view={view}
        canManage={canManage}
        hasClients={clientOptions.length > 0}
        pager={
          <TablePager
            page={register.page}
            pageSize={REGISTER_PAGE_SIZE}
            total={register.total}
            hrefFor={(page) => `/proposals${registerViewSearch({ query: view.query, page })}`}
            label={t('pagerLabel')}
          />
        }
      />
    </div>
  );
}
