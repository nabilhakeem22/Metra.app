'use client';

import { useLocale, useTranslations } from 'next-intl';
import type {
  EngagementChangeOrderRecord,
  EngagementClientActivityRecord,
} from '@/lib/engagements/queries';
import { formatDate } from '@/lib/format/date';
import { formatMoney } from '@/lib/format/money';

// The cockpit MINI-RAIL (mockup's two side-by-side `.mcard`s): Client activity +
// Change orders, two-up on wide and stacked on narrow. Pure composition over data
// the page already loaded — the same P2 client-activity feed and the existing
// change-orders list, each with an honest empty state. Each row is a colored status
// dot + a bold title + a small meta line. Logical CSS only (RTL mirrors); money is
// `font-mono tabular-nums`, `dir=ltr`.
export function EngagementMiniRail({
  clientActivity,
  changeOrders,
}: {
  clientActivity: EngagementClientActivityRecord[];
  changeOrders: EngagementChangeOrderRecord[];
}) {
  const t = useTranslations('engagements');
  const locale = useLocale();

  return (
    <div className="grid gap-3.5 sm:grid-cols-2">
      <MiniCard title={t('panels.clientActivity')}>
        {clientActivity.length === 0 ? (
          <Empty text={t('clientActivity.empty')} />
        ) : (
          <ul className="m-0 list-none p-0">
            {clientActivity.map((entry, index) => (
              <Row
                key={`${entry.kind}-${index}`}
                // Newest first: the latest signal wears the brand dot, older ones
                // the success dot — matching the mockup's highlighted-top row.
                tone={index === 0 ? 'brand' : 'success'}
                title={t(`eventKind.${entry.kind}`)}
                meta={clientActivityMeta(entry, locale, t)}
              />
            ))}
          </ul>
        )}
      </MiniCard>

      <MiniCard title={t('panels.changeOrders')}>
        {changeOrders.length === 0 ? (
          <Empty text={t('changeOrders.empty')} />
        ) : (
          <ul className="m-0 list-none p-0">
            {changeOrders.map((order) => (
              <Row
                key={order.id}
                tone={order.settledAt ? 'success' : 'warn'}
                title={formatMoney(order.amount, locale)}
                titleDir="ltr"
                meta={`${t(`changeOrderStatus.${order.status}`)} · ${formatDate(order.raisedAt, locale)}`}
              />
            ))}
          </ul>
        )}
      </MiniCard>
    </div>
  );
}

function clientActivityMeta(
  entry: EngagementClientActivityRecord,
  locale: string,
  t: ReturnType<typeof useTranslations<'engagements'>>,
): string {
  const parts: string[] = [];
  if (entry.actorName) parts.push(t('clientActivity.by', { name: entry.actorName }));
  parts.push(formatDate(entry.decidedAt, locale));
  return parts.join(' · ');
}

function MiniCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[var(--r-item)] border border-[color:var(--rule)] bg-card p-3.5 text-[color:var(--text)] shadow-sm">
      <div className="mb-2.5 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--text-faint)]">
        {title}
      </div>
      {children}
    </section>
  );
}

function Row({
  tone,
  title,
  titleDir,
  meta,
}: {
  tone: 'brand' | 'success' | 'warn';
  title: string;
  titleDir?: 'ltr';
  meta: string;
}) {
  const dot =
    tone === 'brand'
      ? 'bg-brand'
      : tone === 'warn'
        ? 'bg-[color:var(--warn)]'
        : 'bg-[color:var(--success)]';
  return (
    <li className="flex items-start gap-2.5 py-1.5 text-[12.5px]">
      <span
        className={`mt-1.5 h-[7px] w-[7px] flex-none rounded-full ${dot}`}
        aria-hidden
      />
      <span className="min-w-0">
        <span
          className={`block font-semibold ${titleDir === 'ltr' ? 'font-mono tabular-nums' : ''}`}
          dir={titleDir}
        >
          {title}
        </span>
        <span className="mt-0.5 block text-[11px] text-[color:var(--text-faint)]">
          {meta}
        </span>
      </span>
    </li>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <p className="py-1.5 text-[12.5px] text-[color:var(--text-faint)]">{text}</p>
  );
}
