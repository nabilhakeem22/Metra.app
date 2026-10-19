'use client';

import { useLocale, useTranslations } from 'next-intl';
import { formatNumber } from '@/lib/format/number';

const ONE_DECIMAL: Intl.NumberFormatOptions = Object.freeze({ minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Text marks, not icons: a row carries two chips, and an inline svg icon is ten times the bytes. */
const MARK = { up: '▲', down: '▼', flat: '=' } as const;

/**
 * A computed change ("4.3", "-3.4") as a NEUTRAL mark and its size: a rise is
 * not good and a fall is not bad for a studio, so no colour says either. The
 * sentence for a screen reader names the column (`label`) and the direction.
 */
export function MarketChangeChip({ pct, label }: { pct: string | null; label: string }) {
  const t = useTranslations('marketBook');
  const locale = useLocale();
  if (pct === null) {
    return (
      <span className="text-muted-foreground">
        <span aria-hidden>·</span>
        <span className="sr-only">{`${label}: ${t('change.none')}`}</span>
      </span>
    );
  }
  const falling = pct.startsWith('-');
  const value = `${formatNumber(falling ? pct.slice(1) : pct, locale, ONE_DECIMAL)}%`;
  const flat = Number(pct) === 0;
  const mark = flat ? MARK.flat : falling ? MARK.down : MARK.up;
  const said = flat ? t('change.flat') : t(falling ? 'change.down' : 'change.up', { value });
  return (
    <span className="inline-flex items-center gap-1 rounded-pill bg-[color:var(--track)] px-2 py-0.5 text-caption text-[color:var(--text)]">
      <span aria-hidden className="leading-none">{mark}</span>
      <span dir="ltr" className="font-mono tabular-nums" aria-hidden>
        {value}
      </span>
      <span className="sr-only">{`${label}: ${said}`}</span>
    </span>
  );
}
