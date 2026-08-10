import { organizations } from '@metra/db';
import {
  Banknote,
  FolderKanban,
  ReceiptText,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Gauge } from '@/components/ui/gauge';
import { StatCard } from '@/components/ui/stat-card';
import { requireOrg } from '@/lib/auth/require-org';
import { withOrgContext } from '@/lib/db/context';
import { pickLocale } from '@/lib/i18n/pick-locale';

export default async function DashboardPage() {
  const ctx = await requireOrg();
  const locale = await getLocale();
  const d = await getTranslations('dashboard');
  const tc = await getTranslations('common');

  const [org] = await withOrgContext(ctx, (tx) =>
    tx.select().from(organizations).limit(1),
  );
  const name = pickLocale(org, 'name', locale);

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

      <Card>
        <CardHeader>
          <CardTitle>{d('gaugeTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="flex justify-center py-4">
          <Gauge empty emptyLabel={d('gaugeEmpty')} className="max-w-xs" />
        </CardContent>
      </Card>
    </div>
  );
}
