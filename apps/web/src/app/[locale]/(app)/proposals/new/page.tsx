import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { requireOrg } from '@/lib/auth/require-org';
import { getClientOptions } from '@/lib/clients/queries';
import { can } from '@/lib/permissions/can';
import { listProjects } from '@/lib/projects/queries';
import { ProposalCreateForm } from './create-form';

export default async function NewProposalPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string }>;
}) {
  const { projectId } = await searchParams;
  const ctx = await requireOrg();
  if (!can(ctx.role, 'proposals_build', 'create')) notFound();

  const t = await getTranslations('proposals');
  const [clients, projects] = await Promise.all([
    getClientOptions(ctx),
    listProjects(ctx, { active: true }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title={t('create.title')} />
      <ProposalCreateForm
        clients={clients.map((c) => ({ id: c.id, nameEn: c.nameEn, nameAr: c.nameAr }))}
        projects={projects.map((p) => ({
          id: p.id,
          code: p.code,
          nameEn: p.nameEn,
          nameAr: p.nameAr,
          clientId: p.clientId,
        }))}
        defaultProjectId={projectId}
      />
    </div>
  );
}
