'use client';

import { useLocale, useTranslations } from 'next-intl';
import type {
  EngagementEventRecord,
  EngagementHeader,
} from '@/lib/engagements/queries';
import { formatDate } from '@/lib/format/date';
import { formatMoney } from '@/lib/format/money';
import { Empty } from './engagement-panels-parts';

export function RomPanel({
  header,
  events,
}: {
  header: EngagementHeader;
  events: EngagementEventRecord[];
}) {
  const t = useTranslations('engagements');
  const locale = useLocale();
  const acks = events.filter((e) => e.kind === 'rom_acknowledgement');
  const hasRange = header.romLow !== null && header.romHigh !== null;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-sm">
        <span className="text-[color:var(--text-muted)]">{t('rom.range')}</span>
        {hasRange ? (
          <span className="font-mono tabular-nums" dir="ltr">
            {formatMoney(header.romLow, locale)} – {formatMoney(header.romHigh, locale)}
          </span>
        ) : (
          <span className="text-[color:var(--text-muted)]">{t('rom.notSet')}</span>
        )}
      </div>
      <div className="space-y-1">
        <p className="text-xs font-medium text-[color:var(--text-muted)]">
          {t('rom.acknowledgements')}
        </p>
        {acks.length === 0 ? (
          <Empty text={t('rom.noAcks')} />
        ) : (
          <ul className="space-y-1 text-sm">
            {acks.map((a) => (
              <li key={a.id} className="text-[color:var(--text-muted)]" dir="ltr">
                {formatDate(a.decidedAt, locale)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
