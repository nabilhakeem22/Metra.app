import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { requireOrg } from '@/lib/auth/require-org';
import { getClientOptions } from '@/lib/clients/queries';
import { listEngagements } from '@/lib/engagements/queries';
import { can } from '@/lib/permissions/can';
import { listProjects } from '@/lib/projects/queries';
import { EngagementsClient } from './engagements-client';

export default async function EngagementsPage() {
  const ctx = await requireOrg();
  // Gate the read on the engagements_design read capability in the CALLER (RLS is
  // the second factor) — consistent with the other internal list pages.
  if (!can(ctx.role, 'engagements_design', 'read')) notFound();

  const t = await getTranslations('engagements');
  const [rows, clientOptions, projects] = await Promise.all([
    listEngagements(ctx),
    getClientOptions(ctx),
    listProjects(ctx, { active: true }),
  ]);
  const projectOptions = projects.map((p) => ({
    id: p.id,
    nameEn: p.nameEn,
    nameAr: p.nameAr,
    clientId: p.clientId,
  }));
  const canCreate = can(ctx.role, 'engagements_design', 'create');

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('subtitle')} />
      <EngagementsClient
        items={rows}
        clientOptions={clientOptions}
        projectOptions={projectOptions}
        canCreate={canCreate}
      />
    </div>
  );
}
