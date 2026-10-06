import { getLocale, getTranslations } from 'next-intl/server';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { formatDate } from '@/lib/format/date';
import { formatMoney } from '@/lib/format/money';
import { formatPercent } from '@/lib/format/number';
import type { ProjectDeliverySummary } from '@/lib/engagements/queries';
import type { ProjectOverview } from '@/lib/projects/queries';

/**
 * The through-project Delivery entry point, wired only when the caller may read
 * deliveries (`engagements_design` read). `delivery` is null when the project has
 * none yet; `canStart` gates the "Start delivery" CTA on the create capability.
 */
export interface DeliveryPanelProps {
  delivery: ProjectDeliverySummary | null;
  deliveryCount: number;
  clientId: string;
  projectId: string;
  canStart: boolean;
}

export async function OverviewTab({
  overview,
}: {
  overview: ProjectOverview;
}) {
  const t = await getTranslations('projects.profile.overview');
  const ts = await getTranslations('projects.statuses');
  const tk = await getTranslations('projects.profile.activity.kinds');
  const locale = await getLocale();

  const cur = overview.currentStage;
  const curName = cur
    ? pickLocale({ nameAr: cur.nameAr, nameEn: cur.nameEn }, 'name', locale).value
    : t('noStage');

  // A figure is pinned LTR; a word (a status, "no contracts yet") follows the page.
  const Stat = ({ label, value, figure = true }: { label: string; value: string; figure?: boolean }) => (
    <Card>
      <CardContent className="py-4">
        <p className="text-caption text-muted-foreground">{label}</p>
        <p className="mt-1 text-heading font-semibold" dir={figure ? 'ltr' : undefined}>
          {value}
        </p>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t('status')} value={ts(overview.status)} figure={false} />
        <Card>
          <CardContent className="py-4">
            <p className="text-caption text-muted-foreground">{t('currentStage')}</p>
            <p className="mt-1 text-title font-semibold">{curName}</p>
          </CardContent>
        </Card>
        <Stat label={t('progress')} value={formatPercent(overview.overallProgress, locale)} />
        <Stat
          label={t('contracted')}
          value={formatMoney(overview.contractedTotal, locale)}
        />
      </div>

      <Card>
        <CardContent className="py-4">
          <p className="text-caption text-muted-foreground">{t('stages')}</p>
          <p className="mt-1 text-body">
            {t('stagesDone', {
              done: overview.doneStages,
              total: overview.totalStages,
            })}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <h2 className="border-b px-4 py-2.5 text-body font-semibold">
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
                  className="flex items-center justify-between px-4 py-2.5 text-body"
                >
                  <span>{tk(a.kind)}</span>
                  <span className="text-caption text-muted-foreground" dir="ltr">
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
