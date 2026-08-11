import { organizations } from '@metra/db';
import { sql } from 'drizzle-orm';
import { getLocale, getTranslations } from 'next-intl/server';
import { GettingStarted } from '@/components/dashboard/getting-started';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Gauge } from '@/components/ui/gauge';
import { PageHeader } from '@/components/ui/page-header';
import { Link } from '@/i18n/routing';
import { requireOrg } from '@/lib/auth/require-org';
import { getSessionUser } from '@/lib/auth/session';
import { withOrgContext } from '@/lib/db/context';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { readOnboarding } from '@/lib/onboarding/merge';
import { isProfileComplete } from '@/lib/org/profile';

const LEDGER_ROWS = [
  { key: 'activeProjects', value: '0' },
  { key: 'revisedContractValue', value: '—' },
  { key: 'billedToDate', value: '—' },
  { key: 'collected', value: '—' },
  { key: 'openAR', value: '—' },
  { key: 'costVariance', value: '—' },
] as const;

export default async function DashboardPage() {
  const ctx = await requireOrg();
  const user = await getSessionUser();
  const locale = await getLocale();
  const d = await getTranslations('dashboard');
  const roles = await getTranslations('roles');
  const tc = await getTranslations('common');

  const { org, memberCount, pendingInvites } = await withOrgContext(
    ctx,
    async (tx) => {
      const [o] = await tx.select().from(organizations).limit(1);
      const mem = (await tx.execute(
        sql`select count(*)::int as n from public.memberships`,
      )) as unknown as Array<{ n: number }>;
      const inv = (await tx.execute(
        sql`select count(*)::int as n from public.invitations where status = 'pending'`,
      )) as unknown as Array<{ n: number }>;
      return {
        org: o,
        memberCount: Number(mem[0]?.n ?? 0),
        pendingInvites: Number(inv[0]?.n ?? 0),
      };
    },
  );

  const name = pickLocale(org, 'name', locale);
  const profileComplete = isProfileComplete(org);
  // Ticks on SEND (a live pending invite) as well as on accept.
  const teamInvited = memberCount > 1 || pendingInvites > 0;
  // Per-org dismiss (onboarding.dismissedOrgs), replacing the old global flag.
  const dismissed = (readOnboarding(user?.user_metadata).dismissedOrgs ?? []).includes(
    ctx.orgId,
  );
  const allActionableDone = profileComplete && teamInvited;

  // A real primary action, never a dead disabled control. Once an invite is
  // pending we stop pushing "Invite your team".
  const primary = !profileComplete
    ? { label: d('ctaCompleteProfile'), href: '/settings' as const }
    : !teamInvited
      ? { label: d('ctaInviteTeam'), href: '/team' as const }
      : { label: d('ctaManageTeam'), href: '/team' as const };

  return (
    <div className="space-y-6">
      <PageHeader
        title={name.value}
        description={d('welcomeBack')}
        breadcrumb={
          <span className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              {roles(`${ctx.role}.label`)}
            </span>
            {name.isFallback && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
                {tc('untranslated')}
              </span>
            )}
          </span>
        }
        action={
          <Button asChild>
            <Link href={primary.href}>{primary.label}</Link>
          </Button>
        }
      />

      {!allActionableDone && (
        <GettingStarted
          profileComplete={profileComplete}
          teamInvited={teamInvited}
          dismissed={dismissed}
          orgId={ctx.orgId}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Quiet, authored "ledger" block — honest empty figures, tabular, ruled. */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle>{d('ledgerTitle')}</CardTitle>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {d('p1Hint')}
            </span>
          </CardHeader>
          <div className="divide-y border-t">
            {LEDGER_ROWS.map((row) => (
              <div
                key={row.key}
                className="flex items-center justify-between px-6 py-3"
              >
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span
                    aria-hidden
                    className="size-1.5 rounded-full bg-brand/50"
                  />
                  {d(row.key)}
                </span>
                <span className="tabular text-sm font-semibold text-foreground">
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{d('gaugeTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="flex justify-center py-4">
            <Gauge empty emptyLabel={d('gaugeEmpty')} className="max-w-xs" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
