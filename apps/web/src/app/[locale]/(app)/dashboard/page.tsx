import { organizations } from '@metra/db';
import { getLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { requireOrg } from '@/lib/auth/require-org';
import { getSessionUser } from '@/lib/auth/session';
import { withOrgContext } from '@/lib/db/context';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { buildChecklist } from '@/lib/onboarding/checklist';
import { readOnboarding } from '@/lib/onboarding/merge';
import { getOnboardingProgress } from '@/lib/onboarding/progress';
import { clientColumns, projectColumns } from '@/lib/dashboard/chart-columns';
import { loadDashboardFigures } from '@/lib/dashboard/load-dashboard';
import { pickPrimaryCta } from '@/lib/dashboard/primary-cta';
import { parseRange } from '@/lib/dashboard/range';
import { DashboardView } from './dashboard-view';

// LOADING ONLY. Every figure this page shows is assembled here and handed to
// `DashboardView` as one props object; this file names no presentational
// component. Which figures a role may see is decided in
// `lib/dashboard/load-dashboard.ts`, BEFORE the query — a fence enforced in the
// view would mean the numbers were fetched and then hidden.
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
  const figures = await loadDashboardFigures(ctx, { org, range });

  // The only computation left on this page is the month LABEL, which needs the
  // request's locale. Every shaping decision is in `lib/dashboard/chart-columns`,
  // which has its own tests.
  const monthLabel = (month: string) =>
    new Date(`${month}-01T00:00:00Z`).toLocaleDateString(locale, {
      month: 'short',
      timeZone: 'UTC',
    });

  return (
    <DashboardView
      identity={{
        role: ctx.role,
        orgName: pickLocale(org, 'name', locale),
        primaryCta: pickPrimaryCta(ctx.role, {
          profileComplete: progress.profileComplete,
          teamInvited: progress.teamInvited,
        }),
      }}
      onboarding={{
        checklist: buildChecklist(progress, ctx.role, org.hideMarginFromPm),
        orgId: ctx.orgId,
        // Per-org dismiss (onboarding.dismissedOrgs), replacing the old global flag.
        dismissed: (
          readOnboarding(user?.user_metadata).dismissedOrgs ?? []
        ).includes(ctx.orgId),
      }}
      firm={
        figures.firm && {
          counts: figures.firm.counts,
          charts: {
            projects: projectColumns(figures.firm.projectMonths, range, monthLabel),
            clients: clientColumns(figures.firm.clientMonths, range, monthLabel),
          },
          range,
          canSeeDeliveries: figures.canSeeDeliveries,
          canSeeTeam: figures.canSeeTeam,
        }
      }
      deliveries={figures.deliveries}
      locale={locale}
      now={new Date()}
    />
  );
}
