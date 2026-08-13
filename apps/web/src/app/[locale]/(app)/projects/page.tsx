import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { requireOrg } from '@/lib/auth/require-org';
import { getClientOptions } from '@/lib/clients/queries';
import { can } from '@/lib/permissions/can';
import { listProjects } from '@/lib/projects/queries';
import { ProjectsClient } from './projects-client';
import type { ClientOption, ProjectListItem } from './types';

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ newFor?: string }>;
}) {
  const { newFor } = await searchParams;
  const ctx = await requireOrg();
  if (!can(ctx.role, 'projects', 'read')) notFound();

  const t = await getTranslations('projects');
  const [rows, clientOptions] = await Promise.all([
    listProjects(ctx, {}),
    getClientOptions(ctx),
  ]);

  const items: ProjectListItem[] = rows.map((p) => ({
    id: p.id,
    code: p.code,
    nameEn: p.nameEn,
    nameAr: p.nameAr,
    clientId: p.clientId,
    status: p.status,
    startDate: p.startDate,
    endDate: p.endDate,
    city: p.city,
    address: p.address,
    notes: p.notes,
    active: p.active,
    clientNameEn: p.clientNameEn,
    clientNameAr: p.clientNameAr,
  }));

  const options: ClientOption[] = clientOptions.map((c) => ({
    id: c.id,
    nameEn: c.nameEn,
    nameAr: c.nameAr,
  }));

  const canManage = can(ctx.role, 'projects', 'create');

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('subtitle')} />
      <ProjectsClient
        items={items}
        clientOptions={options}
        canManage={canManage}
        initialNewClientId={newFor}
      />
    </div>
  );
}
