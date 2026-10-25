import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/routing';
import { formatNumber } from '@/lib/format/number';
import { pageCountOf, pagerSlots } from './table-pager-window';

export interface TablePagerProps {
  /** 1-based; a page past either end is drawn as that end. */
  page: number;
  pageSize: number;
  /** How many rows match, across every page. */
  total: number;
  /** The link to `page`, carrying the register's active filters. */
  hrefFor: (page: number) => string;
  /** The navigation's accessible name; a generic "Pages" when omitted. */
  label?: string;
}

/**
 * Which rows a register page shows, and real links (?page=) to the others, so
 * a page opens in a new tab or is shared. Not prefetched: each prefetch is one
 * more render of a page nobody may open. From sm up: "Showing 26 to 50 of 340",
 * Previous, 1 … 4 5 6 … 12, Next; below sm only Previous, "Page 5 of 12", Next.
 * A single page renders nothing. No 'use client': it renders as a server or a
 * client component, whichever renders it.
 */
export function TablePager({ page, pageSize, total, hrefFor, label }: TablePagerProps) {
  const t = useTranslations('common.pager');
  const locale = useLocale();
  const pageCount = pageCountOf(total, pageSize);
  if (pageCount <= 1) return null;
  const current = Math.min(Math.max(1, Math.floor(page)), pageCount);
  const number = (value: number) => formatNumber(value, locale);

  return (
    <nav aria-label={label ?? t('label')} className="flex flex-wrap items-center justify-between gap-2">
      <p className="hidden text-caption text-muted-foreground sm:block">
        {t('range', {
          from: number((current - 1) * pageSize + 1),
          to: number(Math.min(current * pageSize, total)),
          total: number(total),
        })}
      </p>
      <div className="flex flex-1 items-center justify-between gap-2 sm:flex-none sm:justify-end">
        {current > 1 && (
          <Button asChild variant="secondary" size="sm">
            <Link href={hrefFor(current - 1)} prefetch={false} rel="prev">
              <ChevronLeft className="size-4 rtl:-scale-x-100" aria-hidden />
              {t('previous')}
            </Link>
          </Button>
        )}
        <p className="text-caption text-muted-foreground sm:hidden">
          {t('pageOf', { page: number(current), pageCount: number(pageCount) })}
        </p>
        <ol className="hidden items-center gap-1 sm:flex">
          {pagerSlots(current, pageCount).map((slot) =>
            slot.kind === 'gap' ? (
              <li key={`gap-${slot.after}`} aria-hidden className="px-1 text-caption text-muted-foreground">
                …
              </li>
            ) : (
              <li key={slot.page}>
                <Button
                  asChild
                  variant={slot.page === current ? 'secondary' : 'ghost'}
                  size="sm"
                  className="min-w-9 px-2 tabular-nums"
                >
                  <Link
                    href={hrefFor(slot.page)}
                    prefetch={false}
                    aria-label={t('page', { page: number(slot.page) })}
                    aria-current={slot.page === current ? 'page' : undefined}
                  >
                    {number(slot.page)}
                  </Link>
                </Button>
              </li>
            ),
          )}
        </ol>
        {current < pageCount && (
          <Button asChild variant="secondary" size="sm">
            <Link href={hrefFor(current + 1)} prefetch={false} rel="next">
              {t('next')}
              <ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden />
            </Link>
          </Button>
        )}
      </div>
    </nav>
  );
}
