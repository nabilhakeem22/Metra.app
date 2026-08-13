import { getLocale, getTranslations } from 'next-intl/server';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import type { ClientOverview } from '@/lib/clients/queries';
import { formatDate } from '@/lib/format/date';
import { formatMoney } from '@/lib/format/money';

export async function OverviewTab({ overview }: { overview: ClientOverview }) {
  const t = await getTranslations('clients.profile.overview');
  const locale = await getLocale();

  const Stat = ({ label, value }: { label: string; value: string }) => (
    <Card>
      <CardContent className="py-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold" dir="ltr">
          {value}
        </p>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label={t('projects')} value={String(overview.projectCount)} />
        <Stat
          label={t('activeProposals')}
          value={String(overview.activeProposalCount)}
        />
        <Stat
          label={t('contracted')}
          value={formatMoney(overview.contractedTotal, locale)}
        />
      </div>

      <Card>
        <CardContent className="p-0">
          <h2 className="border-b px-4 py-2.5 text-sm font-semibold">
            {t('recentActivity')}
          </h2>
          {overview.recentActivity.length === 0 ? (
            <div className="py-4">
              <EmptyState title={t('noActivity')} />
            </div>
          ) : (
            <ul className="divide-y">
              {overview.recentActivity.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between px-4 py-2.5 text-sm"
                >
                  <ActivityLabel kind={a.kind} />
                  <span className="text-xs text-muted-foreground" dir="ltr">
                    {formatDate(a.createdAt, locale)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

async function ActivityLabel({ kind }: { kind: string }) {
  const t = await getTranslations('clients.profile.activity.kinds');
  return <span>{t(kind)}</span>;
}
