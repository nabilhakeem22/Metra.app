import { organizations } from '@metra/db';
import { getLocale, getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { Compass, FolderKanban, Users, UsersRound } from 'lucide-react';
import { DeliveriesPanel } from '@/components/dashboard/deliveries-panel';
import { DashboardDonut } from '@/components/dashboard/dashboard-donut';
import { DashboardRangeFilter } from '@/components/dashboard/dashboard-range-filter';
import { DashboardStatCard } from '@/components/dashboard/dashboard-stat-card';
import { GettingStarted } from '@/components/dashboard/getting-started';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/routing';
import { requireOrg } from '@/lib/auth/require-org';
import { getSessionUser } from '@/lib/auth/session';
import { withOrgContext } from '@/lib/db/context';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { buildChecklist } from '@/lib/onboarding/checklist';
import { can } from '@/lib/permissions/can';
import { readOnboarding } from '@/lib/onboarding/merge';
import { getOnboardingProgress } from '@/lib/onboarding/progress';
import {
  countActiveDeliveries,
  listDashboardDeliveries,
} from '@/lib/dashboard/queries';
import {
  clientColumns,
  projectColumns,
  sliceTotals,
} from '@/lib/dashboard/chart-columns';
import { loadFirmFigures } from '@/lib/dashboard/firm-figures';
import { canSeeFirmFigures } from '@/lib/dashboard/firm-visibility';
import { pickPrimaryCta } from '@/lib/dashboard/primary-cta';
import { parseRange } from '@/lib/dashboard/range';

/** How many in-flight deliveries the panel shows before deferring to the list. */
const DELIVERY_ROWS = 6;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireOrg();
  // The chart window lives in the URL, so it is shareable and the SERVER does the
  // querying — the charts stay server components with no client-side fetching.
  const range = parseRange((await searchParams).range);
  const user = await getSessionUser();
  const locale = await getLocale();
  const d = await getTranslations('dashboard');
  const roles = await getTranslations('roles');
  const tc = await getTranslations('common');

  const [org] = await withOrgContext(ctx, (tx) =>
    tx.select().from(organizations).limit(1),
  );
  // The org row is resolved through RLS on the ACTIVE org, so it should always
  // exist — but a membership pointing at a row this context cannot read would
  // otherwise crash the whole dashboard on `org.hideMarginFromPm` below. Treat a
  // missing org as "not onboarded yet" rather than a 500.
  if (!org) redirect('/onboarding');

  // Single aggregate drives the checklist; role gates which items appear.
  const progress = await getOnboardingProgress(ctx, org);
  const checklist = buildChecklist(progress, ctx.role, org.hideMarginFromPm);

  const name = pickLocale(org, 'name', locale);
  const profileComplete = progress.profileComplete;
  const teamInvited = progress.teamInvited;
  // Per-org dismiss (onboarding.dismissedOrgs), replacing the old global flag.
  const dismissed = (readOnboarding(user?.user_metadata).dismissedOrgs ?? []).includes(
    ctx.orgId,
  );

  const primary = pickPrimaryCta(ctx.role, { profileComplete, teamInvited });

  // The dashboard's real figures.
  //
  // The deliveries panel is hidden entirely from roles that cannot read
  // engagements, so the query is not even issued for them; the team headcount is
  // gated the same way, on the capability that guards /team itself.
  //
  // THE FIRM-WIDE BLOCK IS NULL FOR A ROLE THAT MAY NOT SEE IT — the four stat
  // cards, both charts and the range filter — and `loadFirmFigures` decides that
  // BEFORE issuing a query, so a fenced role costs zero round trips and the
  // figures it may not see are never computed at all. See
  // `lib/dashboard/firm-visibility.ts` for the two gates (the §2.2 grant, then
  // the org's own narrowing) and why a refusal renders NOTHING rather than a
  // locked placeholder.
  const canSeeDeliveries = can(ctx.role, 'engagements_design', 'read');
  const canSeeTeam = can(ctx.role, 'users_settings', 'read');
  // The panel's badge counts the SAME rows the panel lists, so a role entitled
  // to the work list but not to firm figures still gets a TRUE number rather
  // than the capped `deliveries.length`. One extra indexed count, and only on
  // the fenced path — a caller that already has the firm block reads it from
  // there.
  //
  // It joins the FAN-OUT rather than following it. `canSeeFirmFigures` is pure
  // and is the same predicate `loadFirmFigures` applies to decide whether to
  // issue anything, so whether this count is needed is knowable here, before any
  // query runs. Awaiting it after the Promise.all added a whole serial
  // `withOrgContext` — BEGIN, the GUC preamble, the count, COMMIT — to the
  // critical path of precisely the roles this page was made cheaper for.
  const entitledToFirmFigures = canSeeFirmFigures(ctx.role, org);
  const [firm, deliveries, fencedActiveCount] = await Promise.all([
    loadFirmFigures(ctx, { org, range, includeTeamMembers: canSeeTeam }),
    canSeeDeliveries
      ? listDashboardDeliveries(ctx, DELIVERY_ROWS)
      : Promise.resolve([]),
    !entitledToFirmFigures && canSeeDeliveries
      ? countActiveDeliveries(ctx)
      : Promise.resolve(null),
  ]);

  const activeDeliveries = firm?.counts.deliveriesActive ?? fencedActiveCount ?? 0;

  // The only computation left on this page is the month LABEL, which needs the
  // request's locale. Every shaping decision is in `lib/dashboard/chart-columns`,
  // which has its own tests.
  const monthLabel = (month: string) =>
    new Date(`${month}-01T00:00:00Z`).toLocaleDateString(locale, {
      month: 'short',
      timeZone: 'UTC',
    });
  const charts = firm && {
    projects: projectColumns(firm.projectMonths, range, monthLabel),
    clients: clientColumns(firm.clientMonths, range, monthLabel),
  };
  // The arc starts at the reading edge, so ar-EG sweeps from the other end.
  const rtl = locale.startsWith('ar');

  return (
    <div className="flex flex-col gap-[14px]">
      {/* Page header — eyebrow role pill, org name, greeting; primary CTA at the
          inline-end. Mirrors wholesale in RTL via logical flow. */}
      <div className="flex items-start justify-between gap-4 px-1.5 py-1">
        <div className="flex flex-col gap-1.5">
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant="brand" className="px-2.5 py-[3px]">
              {roles(`${ctx.role}.label`)}
            </Badge>
            {name.isFallback && <Badge>{tc('untranslated')}</Badge>}
          </span>
          <h1
            className="text-display text-[28px] text-[color:var(--text)]"
            style={{ lineHeight: 1.25 }}
          >
            {name.value}
          </h1>
          <p className="text-sm text-[color:var(--text-muted)]">
            {d('welcomeBack')}
          </p>
        </div>
        <div className="shrink-0">
          <Button asChild size="lg">
            <Link href={primary.href}>{d(primary.messageKey)}</Link>
          </Button>
        </div>
      </div>

      <GettingStarted result={checklist} orgId={ctx.orgId} dismissed={dismissed} />

      {/* The headline figures, each a link into the module it counts. FIRM-WIDE:
          absent entirely for a role the firm has not entitled to them. */}
      {firm && (
        <div className="grid gap-[14px] sm:grid-cols-2 lg:grid-cols-4">
          <DashboardStatCard
            label={d('cards.clients')}
            value={firm.counts.clientsTotal}
            activeLabel={d('cards.active')}
            activeValue={firm.counts.clientsActive}
            icon={Users}
            href="/clients"
          />
          <DashboardStatCard
            label={d('cards.projects')}
            value={firm.counts.projectsTotal}
            activeLabel={d('cards.active')}
            activeValue={firm.counts.projectsActive}
            icon={FolderKanban}
            href="/projects"
          />
          {canSeeDeliveries && (
            <DashboardStatCard
              label={d('cards.deliveries')}
              value={firm.counts.deliveriesTotal}
              activeLabel={d('cards.inFlight')}
              activeValue={firm.counts.deliveriesActive}
              icon={Compass}
              href="/engagements"
            />
          )}
          {canSeeTeam && (
            <DashboardStatCard
              label={d('cards.team')}
              value={firm.counts.teamMembers ?? 0}
              icon={UsersRound}
              href="/team"
            />
          )}
        </div>
      )}

      {canSeeDeliveries && (
        <DeliveriesPanel
          deliveries={deliveries}
          totalActive={activeDeliveries}
          locale={locale}
          now={new Date()}
        />
      )}

      {/* The range filter belongs to the charts, so it goes with them: leaving a
          control that reshapes figures nobody can see would be a dead affordance. */}
      {charts && (
        <>
          <div className="flex items-center justify-end">
            <DashboardRangeFilter active={range} />
          </div>

          <div className="grid gap-[14px] lg:grid-cols-2">
            <DashboardDonut
              title={d('charts.projects')}
              summary={d('charts.projectsSummary', { n: range })}
              emptyLabel={d('charts.empty')}
              totalLabel={d('charts.total')}
              slices={sliceTotals(charts.projects, [
                'active',
                'completed',
                'other',
              ])}
              rtl={rtl}
              series={[
                { key: 'active', label: d('charts.statusActive'), token: '--chart-1' },
                { key: 'completed', label: d('charts.statusCompleted'), token: '--chart-2' },
                { key: 'other', label: d('charts.statusOther'), token: '--chart-3' },
              ]}
            />
            <DashboardDonut
              title={d('charts.clients')}
              summary={d('charts.clientsSummary', { n: range })}
              emptyLabel={d('charts.empty')}
              totalLabel={d('charts.total')}
              slices={sliceTotals(charts.clients, ['active', 'inactive'])}
              rtl={rtl}
              series={[
                { key: 'active', label: d('charts.clientActive'), token: '--chart-1' },
                { key: 'inactive', label: d('charts.clientInactive'), token: '--chart-3' },
              ]}
            />
          </div>
        </>
      )}
    </div>
  );
}
