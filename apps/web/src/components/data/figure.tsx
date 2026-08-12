'use client';

import { useLocale } from 'next-intl';
import { formatMoney } from '@/lib/format/money';
import { cn } from '@/lib/utils';

/**
 * The money law made a component: any figure rendered mono / tabular / LTR /
 * inline-end (the `.num` utility). Formatters are unchanged — this only applies
 * the font + alignment at render.
 */
export function Figure({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <span className={cn('num', className)}>{children}</span>;
}

/** A money value formatted for the active locale (Western numerals), in `.num`. */
export function Money({
  value,
  className,
}: {
  value: string | number | null | undefined;
  className?: string;
}) {
  const locale = useLocale();
  return <Figure className={className}>{formatMoney(value, locale)}</Figure>;
}
