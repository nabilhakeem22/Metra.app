import { getTranslations } from 'next-intl/server';
import { formatMonth } from '@/lib/format/date';
import { formatNumber } from '@/lib/format/number';
import type { MarketBulletinSummary } from '@/lib/market-book/types';

/**
 * Where the figures come from, on every market surface and in every drawer
 * (D7): the ministry's bulletin, how it is collected, that it is guidance only,
 * and which bulletin is the latest. Studio surfaces only, never a client one.
 */
export async function MarketAttribution({ bulletin, locale }: { bulletin: MarketBulletinSummary; locale: string }) {
  const t = await getTranslations('marketBook.attribution');
  return (
    <aside className="space-y-1 rounded-item border bg-muted/30 p-3 text-caption text-muted-foreground">
      <p className="font-medium text-[color:var(--text)]">{t('asOf', { month: formatMonth(bulletin.periodMonth, locale) })}</p>
      <p>{t('source')}</p>
      <p>
        {t('method', {
          fromDay: formatNumber(bulletin.collectionFromDay, locale),
          toDay: formatNumber(bulletin.collectionToDay, locale),
        })}
      </p>
      <p>{t('notBinding')}</p>
    </aside>
  );
}
