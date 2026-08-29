import { organizations } from '@metra/db';
import { getLocale, getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { DashboardLedgerCard } from '@/components/dashboard/dashboard-ledger-card';
import { DashboardPortfolioCard } from '@/components/dashboard/dashboard-portfolio-card';
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

// Ledger row set + honest empty figures — unchanged data (visual reskin only).
// Portfolio progress activates in P1 alongside real active-project counts.
const LEDGER_ROWS = [
  { key: 'activeProjects', value: '0' },
  { key: 'revisedContractValue', value: '—' },
  { key: 'billedToDate', value: '—' },
  { key: 'collected', value: '—' },
  { key: 'openAR', value: '—' },
  { key: 'costVariance', value: '—' },
] as const;

export default async function DashboardPage() {
  try {
    return await renderDashboard();
  } catch (err) {
    // TEMP DIAGNOSTIC: Next redacts server-component errors in production (the
    // browser only gets a digest), which makes an authenticated-only 500
    // undiagnosable. Surface the real stack here; re-throw Next's own
    // control-flow signals so redirect()/notFound() keep working.
    const digest = (err as { digest?: string })?.digest;
    if (
      typeof digest === 'string' &&
      (digest === 'NEXT_NOT_FOUND' || digest.startsWith('NEXT_REDIRECT'))
    ) {
      throw err;
    }
    console.error('[dashboard-diagnostic]', err);
    return (
      <pre className="m-4 overflow-auto whitespace-pre-wrap rounded-lg border border-[color:var(--warn-tint)] bg-[color:var(--warn-tint)] p-4 text-xs text-[color:var(--warn)]">
        {`Dashboard diagnostic (temporary) — the real server error:\n\n${String(
          (err as Error)?.stack ?? err,
        )}`}
      </pre>
    );
  }
}

async function renderDashboard() {
  const ctx = await requireOrg();
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

  const ledgerRows = LEDGER_ROWS.map((row) => ({
    key: row.key,
    label: d(row.key),
    value: row.value,
  }));

  // No portfolio-progress data source until there are active projects → honest
  // empty gauge. (0 active projects today.)
  const activeProjectsCount = Number(
    LEDGER_ROWS.find((row) => row.key === 'activeProjects')?.value ?? 0,
  );
  const portfolioProgress = activeProjectsCount > 0 ? 0 : null;

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

      <div className="grid items-start gap-[14px] lg:grid-cols-3">
        <DashboardLedgerCard
          className="lg:col-span-2"
          title={d('ledgerTitle')}
          statusLabel={d('p1Hint')}
          rows={ledgerRows}
        />
        <DashboardPortfolioCard
          title={d('gaugeTitle')}
          value={portfolioProgress}
          emptyLabel={d('gaugeEmpty')}
        />
      </div>
    </div>
  );
}
