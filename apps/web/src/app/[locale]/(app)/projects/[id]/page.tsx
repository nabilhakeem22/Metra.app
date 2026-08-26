import { ArrowLeft } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/routing';
import { requireOrg } from '@/lib/auth/require-org';
import { listActivities } from '@/lib/activities/queries';
import { getClientOptions } from '@/lib/clients/queries';
import {
  countProjectDeliveries,
  getEngagementByProject,
} from '@/lib/engagements/queries';
import { listProjectDocuments } from '@/lib/project-documents/queries';
import { listStages } from '@/lib/project-stages/queries';
import { listProjectTypes } from '@/lib/project-types/queries';
import { getProjectById, getProjectOverview } from '@/lib/projects/queries';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { can } from '@/lib/permissions/can';
import { listProposals } from '@/lib/proposals/queries';
import { ActivityTab } from './activity-tab';
import { DetailsTab } from './details-tab';
import { DocumentsTab } from './documents-tab';
import { FinancialsTab } from './financials-tab';
import { OverviewTab } from './overview-tab';
import { ProfileTabs } from './profile-tabs';
import { ProposalsTab } from './proposals-tab';
import { StagesTab } from './stages-tab';
import { PROJECT_TABS, type ProjectTab } from './tabs';
import { TeamTab } from './team-tab';

export default async function ProjectProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab: tabParam } = await searchParams;
  const ctx = await requireOrg();
  if (!can(ctx.role, 'projects', 'read')) notFound();

  const project = await getProjectById(ctx, id);
  if (!project) notFound();

  const tab: ProjectTab = PROJECT_TABS.includes(tabParam as ProjectTab)
    ? (tabParam as ProjectTab)
    : 'overview';

  const t = await getTranslations('projects.profile');
  const locale = await getLocale();
  const canManage = can(ctx.role, 'projects', 'update');
  const canActivity = can(ctx.role, 'project_activity', 'create');
  const name = pickLocale(
    { nameAr: project.nameAr, nameEn: project.nameEn },
    'name',
    locale,
  ).value;
  const typeName = project.typeId
    ? pickLocale(
        { nameAr: project.typeNameAr, nameEn: project.typeNameEn },
        'name',
        locale,
      ).value
    : t('noType');

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Link
          href="/projects"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3" aria-hidden />
          {t('back')}
        </Link>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <span aria-hidden className="h-5 w-[3px] rounded-full bg-brand" />
          {name}
        </h1>
        <p className="text-sm text-muted-foreground">
          <span className="font-mono" dir="ltr">{project.code}</span> · {typeName}
        </p>
      </div>

      <ProfileTabs projectId={id} active={tab} />

      <div
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
        tabIndex={0}
        className="focus:outline-none"
      >
        {tab === 'overview' && (
          <OverviewTab
            overview={await getProjectOverview(ctx, id)}
            deliveryPanel={
              can(ctx.role, 'engagements_design', 'read')
                ? {
                    delivery: await getEngagementByProject(ctx, id),
                    deliveryCount: await countProjectDeliveries(ctx, id),
                    clientId: project.clientId,
                    projectId: id,
                    canStart: can(ctx.role, 'engagements_design', 'create'),
                  }
                : undefined
            }
          />
        )}
        {tab === 'details' && (
          <DetailsTab
            project={project}
            clientOptions={await getClientOptions(ctx)}
            projectTypes={(await listProjectTypes(ctx)).map((ty) => ({
              id: ty.id,
              nameEn: ty.nameEn,
              nameAr: ty.nameAr,
            }))}
            canManage={canManage}
          />
        )}
        {tab === 'stages' && (
          <StagesTab
            projectId={id}
            stages={await listStages(ctx, id)}
            canManage={canManage}
          />
        )}
        {tab === 'financials' && (
          <FinancialsTab
            contractedTotal={(await getProjectOverview(ctx, id)).contractedTotal}
            advancePct={project.advancePct}
            retentionPct={project.retentionPct}
          />
        )}
        {tab === 'team' && <TeamTab />}
        {tab === 'proposals' && (
          <ProposalsTab
            projectId={id}
            proposals={await listProposals(ctx, { projectId: id })}
            canBuild={can(ctx.role, 'proposals_build', 'create')}
          />
        )}
        {tab === 'documents' && (
          <DocumentsTab
            projectId={id}
            documents={await listProjectDocuments(ctx, id)}
            canManage={canActivity}
          />
        )}
        {tab === 'activity' && (
          <ActivityTab
            projectId={id}
            activities={await listActivities(ctx, 'project', id)}
            canActivity={canActivity}
          />
        )}
      </div>
    </div>
  );
}
