import { organizations } from '@metra/db';
import { sql } from 'drizzle-orm';
import {
  Banknote,
  FolderKanban,
  ReceiptText,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { GettingStarted } from '@/components/dashboard/getting-started';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Gauge } from '@/components/ui/gauge';
import { StatCard } from '@/components/ui/stat-card';
import { requireOrg } from '@/lib/auth/require-org';
import { getSessionUser } from '@/lib/auth/session';
import { withOrgContext } from '@/lib/db/context';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { isProfileComplete } from '@/lib/org/profile';

export default async function DashboardPage() {
  const ctx = await requireOrg();
  const user = await getSessionUser();
  const locale = await getLocale();
  const d = await getTranslations('dashboard');
  const nav = await getTranslations('nav');
  const tc = await getTranslations('common');

  const { org, memberCount } = await withOrgContext(ctx, async (tx) => {
    const [o] = await tx.select().from(organizations).limit(1);
    const rows = (await tx.execute(
      sql`select count(*)::int as n from public.memberships`,
    )) as unknown as Array<{ n: number }>;
    return { org: o, memberCount: Number(rows[0]?.n ?? 0) };
  });

  const name = pickLocale(org, 'name', locale);
  const profileComplete = isProfileComplete(org);
  const teamInvited = memberCount > 1;
  const dismissed = user?.user_metadata?.checklist_dismissed === true;
  const allActionableDone = profileComplete && teamInvited;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">{d('welcomeBack')}</p>
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold tracking-tight">
          {name.value}
          {name.isFallback && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
              {tc('untranslated')}
            </span>
          )}
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            {ctx.role}
          </span>
        </h1>
      </header>

      {!allActionableDone && (
        <GettingStarted
          profileComplete={profileComplete}
          teamInvited={teamInvited}
          dismissed={dismissed}
        />
      )}

      {/* Honest empty state — no fabricated figures. Counts are 0, money is —. */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          variant="gradient"
          accent="blue"
          label={d('activeProjects')}
          value="0"
          empty="0"
          icon={<FolderKanban className="size-5" />}
          hint={d('p1Hint')}
        />
        <StatCard
          variant="gradient"
          accent="amber"
          label={d('revisedContractValue')}
          value={null}
          empty="—"
          icon={<Wallet className="size-5" />}
          hint={d('p1Hint')}
        />
        <StatCard
          label={d('billedToDate')}
          value={null}
          empty="—"
          icon={<ReceiptText className="size-5" />}
          hint={d('p1Hint')}
        />
        <StatCard
          label={d('collected')}
          value={null}
          empty="—"
          icon={<Banknote className="size-5" />}
          hint={d('p1Hint')}
        />
        <StatCard
          label={d('openAR')}
          value={null}
          empty="—"
          hint={d('p1Hint')}
        />
        <StatCard
          label={d('costVariance')}
          value={null}
          empty="—"
          icon={<TrendingUp className="size-5" />}
          hint={d('p1Hint')}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Directive empty state — guidance + CTA (the template P1 inherits). */}
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={<FolderKanban className="size-6" />}
              title={d('noProjectsTitle')}
              description={d('noProjectsDescription')}
              hint={d('p1Hint')}
              action={
                <Button variant="outline" disabled>
                  {nav('proposals')}
                </Button>
              }
            />
          </CardContent>
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
