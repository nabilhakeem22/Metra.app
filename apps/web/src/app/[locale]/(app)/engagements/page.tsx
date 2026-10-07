import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { requireOrg } from '@/lib/auth/require-org';
import { getClientOptions } from '@/lib/clients/queries';
import { listEngagements, MY_MOVE_SCAN_LIMIT } from '@/lib/engagements/queries';
import { can } from '@/lib/permissions/can';
import { listProjects } from '@/lib/projects/queries';
import { EngagementsClient } from './engagements-client';

export default async function EngagementsPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; before?: string; move?: string }>;
}) {
  const { new: openCreate, before, move } = await searchParams;
  // "My move" is one page of its own; otherwise the keyset cursor of an older
  // page, and anything else reads the newest page.
  const mine = move === 'mine';
  const beforeNumber = !mine && before && /^\d+$/.test(before) ? Number(before) : undefined;
  const ctx = await requireOrg();
  // Gate the read on the engagements_design read capability in the CALLER (RLS is
  // the second factor) — consistent with the other internal list pages.
  if (!can(ctx.role, 'engagements_design', 'read')) notFound();

  const t = await getTranslations('engagements');
  const [page, clientOptions, projects] = await Promise.all([
    listEngagements(ctx, mine ? { move: 'mine' } : { before: beforeNumber }),
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
        view={{ mine, truncatedAt: page.truncated ? MY_MOVE_SCAN_LIMIT : null }}
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
