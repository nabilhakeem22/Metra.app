import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { requireOrg } from '@/lib/auth/require-org';
import { getClientOptions } from '@/lib/clients/queries';
import { listEngagements } from '@/lib/engagements/queries';
import { can } from '@/lib/permissions/can';
import { listProjects } from '@/lib/projects/queries';
import { EngagementsClient } from './engagements-client';

export default async function EngagementsPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; before?: string }>;
}) {
  const { new: openCreate, before } = await searchParams;
  // The keyset cursor of an older page; anything else reads the newest page.
  const beforeNumber = before && /^\d+$/.test(before) ? Number(before) : undefined;
  const ctx = await requireOrg();
  // Gate the read on the engagements_design read capability in the CALLER (RLS is
  // the second factor) — consistent with the other internal list pages.
  if (!can(ctx.role, 'engagements_design', 'read')) notFound();

  const t = await getTranslations('engagements');
  const [page, clientOptions, projects] = await Promise.all([
    listEngagements(ctx, { before: beforeNumber }),
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
        items={page.rows}
        paging={{ nextBefore: page.nextBefore, isFirstPage: beforeNumber === undefined }}
        clientOptions={clientOptions}
        projectOptions={projectOptions}
        canCreate={canCreate}
        setupLinks={{
          canAddClient: can(ctx.role, 'clients', 'create'),
          canAddProject: can(ctx.role, 'projects', 'create'),
        }}
        openCreateOnArrival={openCreate === '1'}
        nowIso={new Date().toISOString()}
      />
    </div>
  );
}
