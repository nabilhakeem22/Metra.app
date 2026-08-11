import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { requireOrg } from '@/lib/auth/require-org';
import { getClientOptions } from '@/lib/clients/queries';
import { can } from '@/lib/permissions/can';
import { listProposals } from '@/lib/proposals/queries';
import { ProposalsClient } from './proposals-client';

export default async function ProposalsPage() {
  const ctx = await requireOrg();
  if (!can(ctx.role, 'proposals_build', 'read')) notFound();

  const t = await getTranslations('proposals');
  const [rows, clientOptions] = await Promise.all([
    listProposals(ctx, {}),
    getClientOptions(ctx),
  ]);
  const canManage = can(ctx.role, 'proposals_build', 'create');

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('subtitle')} />
      <ProposalsClient
        items={rows}
        canManage={canManage}
        hasClients={clientOptions.length > 0}
      />
    </div>
  );
}
