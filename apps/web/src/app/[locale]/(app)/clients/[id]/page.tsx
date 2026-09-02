import { ArrowLeft } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/routing';
import { requireOrg } from '@/lib/auth/require-org';
import { listActivities } from '@/lib/activities/queries';
import { listClientDocuments } from '@/lib/client-documents/queries';
import { listContacts } from '@/lib/client-contacts/queries';
import { getClientEffectiveRates } from '@/lib/clients/financials';
import { getClientById, getClientOverview } from '@/lib/clients/queries';
import { getDeliveriesByProjects } from '@/lib/engagements/queries';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { can } from '@/lib/permissions/can';
import { listProjects } from '@/lib/projects/queries';
import { ActivityTab } from './activity-tab';
import { ClientCreatedHandoff } from './client-created-handoff';
import { ContactsTab } from './contacts-tab';
import { DetailsTab } from './details-tab';
import { DocumentsTab } from './documents-tab';
import { FinancialsTab } from './financials-tab';
import { OverviewTab } from './overview-tab';
import { ProfileTabs } from './profile-tabs';
import { CLIENT_TABS, type ClientTab } from './tabs';
import { ProjectsTab } from './projects-tab';

export default async function ClientProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab: tabParam } = await searchParams;
  const ctx = await requireOrg();
  // The client role has no `clients` access -> 404.
  if (!can(ctx.role, 'clients', 'read')) notFound();

  const client = await getClientById(ctx, id);
  if (!client) notFound();

  const tab: ClientTab = CLIENT_TABS.includes(tabParam as ClientTab)
    ? (tabParam as ClientTab)
    : 'overview';

  const t = await getTranslations('clients.profile');
  const tt = await getTranslations('clients.types');
  const locale = await getLocale();
  const canManage = can(ctx.role, 'clients', 'update');
  const canActivity = can(ctx.role, 'client_activity', 'create');
  const canReadDeliveries = can(ctx.role, 'engagements_design', 'read');

  // Load the client's projects once for the Projects tab and reuse the same array
  // for the batch delivery-status read (one round-trip, no N+1). Both are computed
  // only when that tab is active, mirroring the lazy per-tab loads below. The
  // delivery map is read only when the role holds `engagements_design:read`; without
  // it the tab omits the delivery column entirely.
  const clientProjects =
    tab === 'projects' ? await listProjects(ctx, { clientId: id }) : [];
  const deliveries =
    tab === 'projects' && canReadDeliveries
      ? await getDeliveriesByProjects(
          ctx,
          clientProjects.map((project) => project.id),
        )
      : {};
  const name = pickLocale(
    { nameAr: client.nameAr, nameEn: client.nameEn },
    'name',
    locale,
  ).value;

  return (
    <div className="space-y-4">
      <ClientCreatedHandoff
        clientId={id}
        clientName={name}
        canCreateProject={can(ctx.role, 'projects', 'create')}
      />

      <div className="space-y-1">
        <Link
          href="/clients"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3" aria-hidden />
          {t('back')}
        </Link>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <span aria-hidden className="h-5 w-[3px] rounded-full bg-brand" />
          {name}
        </h1>
        <p className="text-sm text-muted-foreground">{tt(client.type)}</p>
      </div>

      <ProfileTabs clientId={id} active={tab} />

      <div
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
        tabIndex={0}
        className="focus:outline-none"
      >
        {tab === 'overview' && (
          <OverviewTab overview={await getClientOverview(ctx, id)} />
        )}
        {tab === 'details' && (
          <DetailsTab client={client} canManage={canManage} />
        )}
        {tab === 'contacts' && (
          <ContactsTab
            clientId={id}
            contacts={await listContacts(ctx, id)}
            canManage={canManage}
          />
        )}
        {tab === 'projects' && (
          <ProjectsTab
            clientId={id}
            projects={clientProjects}
            canManage={can(ctx.role, 'projects', 'create')}
            deliveries={deliveries}
            canReadDeliveries={canReadDeliveries}
          />
        )}
        {tab === 'financials' && (
          <FinancialsTab
            contractedTotal={(await getClientOverview(ctx, id)).contractedTotal}
            {...(await getClientEffectiveRates(ctx, id))}
          />
        )}
        {tab === 'documents' && (
          <DocumentsTab
            clientId={id}
            documents={await listClientDocuments(ctx, id)}
            canManage={canActivity}
          />
        )}
        {tab === 'activity' && (
          <ActivityTab
            clientId={id}
            activities={await listActivities(ctx, 'client', id)}
            canActivity={canActivity}
          />
        )}
      </div>
    </div>
  );
}
