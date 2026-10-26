'use client';

import { useLocale, useTranslations } from 'next-intl';
import { StatusChip } from '@/components/ui/status-chip';
import { pluralParams } from '@/lib/format/plural-params';

/**
 * The Execution tab's CHANGE ORDERS while some wait for the client's decision:
 * how many, and where to answer them, each change order's own link the studio
 * sent (deciding moves into this page with its one-time code in a later step).
 * Shown only while one is open; a lapsed one is the hero's line, since only the
 * studio can act on it. فصحى copy, Latin digits.
 */
export function ExecutionChangeOrders({ openCount, firmName }: { openCount: number; firmName: string }) {
  const t = useTranslations('delivery.changeOrders');
  const locale = useLocale();
  return (
    <section id="change-orders" aria-labelledby="home-change-orders-title" className="space-y-2 rounded-panel border bg-background p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="home-change-orders-title" className="text-body font-semibold">
          {t('title')}
        </h2>
        <StatusChip tone="yourMove" label={t('awaiting')} />
      </div>
      <p className="text-body font-medium">{t('open', pluralParams('count', 'countText', openCount, locale))}</p>
      <p className="rounded-item bg-muted/50 p-3 text-caption text-muted-foreground">{t('answerWithLink', { studio: firmName })}</p>
    </section>
  );
}
