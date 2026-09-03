import { organizations } from '@metra/db';
import { getLocale, getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { FolderKanban, Users, UsersRound } from 'lucide-react';
import { DashboardBarChart } from '@/components/dashboard/dashboard-bar-chart';
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
import { readOnboarding } from '@/lib/onboarding/merge';
import { getOnboardingProgress } from '@/lib/onboarding/progress';
import {
  getClientsByMonth,
  getDashboardCounts,
  getProjectsByMonth,
} from '@/lib/dashboard/queries';
import { fillMonths, parseRange } from '@/lib/dashboard/range';

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

  // A real primary action, never a dead disabled control. Once an invite is
  // pending we stop pushing "Invite your team".
  const primary = !profileComplete
    ? { label: d('ctaCompleteProfile'), href: '/settings' as const }
    : !teamInvited
      ? { label: d('ctaInviteTeam'), href: '/team' as const }
      : { label: d('ctaManageTeam'), href: '/team' as const };

  // The dashboard's real figures. Three reads in parallel — the counts, and the
  // two monthly series behind the charts.
  const [counts, projectMonths, clientMonths] = await Promise.all([
    getDashboardCounts(ctx),
    getProjectsByMonth(ctx, range),
    getClientsByMonth(ctx, range),
  ]);

  // Postgres only returns months that HAVE rows, so the gaps are filled here: a
  // chart that silently skips a quiet month misrepresents the trend.
  const monthLabel = (month: string) =>
    new Date(`${month}-01T00:00:00Z`).toLocaleDateString(locale, {
      month: 'short',
      timeZone: 'UTC',
    });
  const projectColumns = fillMonths(
    projectMonths,
    range,
    (month) => ({ month, active: 0, completed: 0, other: 0 }),
  ).map((m) => ({
    month: m.month,
    label: monthLabel(m.month),
    segments: [
      { key: 'active', value: m.active },
      { key: 'completed', value: m.completed },
      { key: 'other', value: m.other },
    ],
  }));
  const clientColumns = fillMonths(
    clientMonths,
    range,
    (month) => ({ month, active: 0, inactive: 0 }),
  ).map((m) => ({
    month: m.month,
    label: monthLabel(m.month),
    segments: [
      { key: 'active', value: m.active },
      { key: 'inactive', value: m.inactive },
    ],
  }));

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
            <Link href={primary.href}>{primary.label}</Link>
          </Button>
        </div>
      </div>

      <GettingStarted result={checklist} orgId={ctx.orgId} dismissed={dismissed} />

      {/* Three headline figures, each a link into the module it counts. */}
      <div className="grid gap-[14px] sm:grid-cols-2 lg:grid-cols-3">
        <DashboardStatCard
          label={d('cards.clients')}
          value={counts.clientsTotal}
          activeLabel={d('cards.active')}
          activeValue={counts.clientsActive}
          icon={Users}
          href="/clients"
        />
        <DashboardStatCard
          label={d('cards.projects')}
          value={counts.projectsTotal}
          activeLabel={d('cards.active')}
          activeValue={counts.projectsActive}
          icon={FolderKanban}
          href="/projects"
        />
        <DashboardStatCard
          label={d('cards.team')}
          value={counts.teamMembers}
          icon={UsersRound}
          href="/team"
        />
      </div>

      <div className="flex items-center justify-end">
        <DashboardRangeFilter active={range} />
      </div>

      <div className="grid gap-[14px] lg:grid-cols-2">
        <DashboardBarChart
          title={d('charts.projects')}
          summary={d('charts.projectsSummary', { n: range })}
          emptyLabel={d('charts.empty')}
          totalLabel={d('charts.total')}
          columns={projectColumns}
          series={[
            { key: 'active', label: d('charts.statusActive'), token: '--chart-1' },
            { key: 'completed', label: d('charts.statusCompleted'), token: '--chart-2' },
            { key: 'other', label: d('charts.statusOther'), token: '--chart-3' },
          ]}
        />
        <DashboardBarChart
          title={d('charts.clients')}
          summary={d('charts.clientsSummary', { n: range })}
          emptyLabel={d('charts.empty')}
          totalLabel={d('charts.total')}
          columns={clientColumns}
          series={[
            { key: 'active', label: d('charts.clientActive'), token: '--chart-1' },
            { key: 'inactive', label: d('charts.clientInactive'), token: '--chart-3' },
          ]}
        />
      </div>
    </div>
  );
}
