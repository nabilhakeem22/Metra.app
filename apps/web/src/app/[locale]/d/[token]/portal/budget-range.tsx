'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { PublicDelivery } from '@/lib/engagements/public';
import { moneySymbol } from '@/lib/format/money';
import { formatPortalAmount } from './portal-money';

type RangePart = { kind: 'figure' | 'word' | 'currency'; text: string };

const PART_CLASS: Record<RangePart['kind'], string> = {
  figure: 'text-heading font-bold tabular-nums',
  word: 'text-body text-muted-foreground',
  currency: 'text-body font-semibold text-muted-foreground',
};

/**
 * The parts of the band in reading order, with the currency label once, beside
 * the figures: BEFORE the first one in English ("EGP 900,000 to 1,200,000"),
 * AFTER the last one in Arabic, where the row reads right to left and so ends at
 * the far left ("900,000 إلى 1,200,000 ج.م"). Null when no bound is issued.
 */
function rangeParts(
  low: string,
  high: string,
  words: { to: string; from: string; upTo: string },
  locale: string,
): RangePart[] | null {
  const figure = (text: string): RangePart => ({ kind: 'figure', text });
  const word = (text: string): RangePart => ({ kind: 'word', text });
  let parts: RangePart[];
  if (low && high) parts = [figure(low), word(words.to), figure(high)];
  else if (low) parts = [word(words.from), figure(low)];
  else if (high) parts = [word(words.upTo), figure(high)];
  else return null;

  const currency: RangePart = { kind: 'currency', text: moneySymbol(locale) };
  if (locale.startsWith('ar')) return [...parts, currency];
  const firstFigure = parts.findIndex((part) => part.kind === 'figure');
  return [...parts.slice(0, firstFigure), currency, ...parts.slice(firstFigure)];
}

/**
 * The issued budget band, big. The row follows the document direction; each
 * figure (and the currency label) is its own isolate, a figure forced
 * left-to-right, so the digits stay Latin and in order inside a number while the
 * parts read in the locale's order. A lone bound reads "From X" / "Up to X" on
 * the same rule. No bound issued: nothing.
 */
export function BudgetRange({ rom }: { rom: PublicDelivery['rom'] }) {
  const t = useTranslations('delivery.budget');
  const locale = useLocale();
  const parts = rangeParts(
    formatPortalAmount(rom?.low, locale),
    formatPortalAmount(rom?.high, locale),
    { to: t('to'), from: t('from'), upTo: t('upTo') },
    locale,
  );
  if (!parts) return null;

  return (
    <p className="flex flex-wrap items-baseline gap-2">
      {parts.map((part, index) =>
        part.kind === 'word' ? (
          <span key={index} data-part={part.kind} className={PART_CLASS.word}>
            {part.text}
          </span>
        ) : (
          <bdi
            key={index}
            data-part={part.kind}
            dir={part.kind === 'figure' ? 'ltr' : undefined}
            className={PART_CLASS[part.kind]}
          >
            {part.text}
          </bdi>
        ),
      )}
    </p>
  );
}
