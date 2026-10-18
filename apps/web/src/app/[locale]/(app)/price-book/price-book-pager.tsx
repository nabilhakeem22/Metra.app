'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/routing';
import { formatNumber } from '@/lib/format/number';
import { PRICE_BOOK_PAGE_SIZE, priceBookViewSearch, type PriceBookView } from '@/lib/price-book/page-params';

/**
 * Which of the matching items this page shows, and links to the pages either
 * side: real links (?page=), so a page opens in a new tab or is shared. Each
 * link carries the toolbar's filters as chosen (`viewAt`), so a filter clicked
 * just before is not undone by a page its answer has not reached yet. Not
 * prefetched: each prefetch is one more render of a page nobody may open. A
 * single page has nothing to page through and renders nothing.
 */
export function PriceBookPager({
  viewAt,
  page,
  pageCount,
  matched,
}: {
  /** The view a link to `page` opens. */
  viewAt: (page: number) => PriceBookView;
  page: number;
  pageCount: number;
  matched: number;
}) {
  const t = useTranslations('priceBook.pager');
  const locale = useLocale();
  if (pageCount <= 1) return null;
  const first = (page - 1) * PRICE_BOOK_PAGE_SIZE + 1;
  const last = Math.min(page * PRICE_BOOK_PAGE_SIZE, matched);
  const pageHref = (target: number) => `/price-book${priceBookViewSearch(viewAt(target))}`;

  return (
    <nav aria-label={t('label')} className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-caption text-muted-foreground">
        {t('range', {
          from: formatNumber(first, locale),
          to: formatNumber(last, locale),
          total: formatNumber(matched, locale),
        })}
      </p>
      <div className="flex items-center gap-2">
        {page > 1 && (
          <Button asChild variant="secondary" size="sm">
            <Link href={pageHref(page - 1)} prefetch={false} rel="prev">
              <ChevronLeft className="size-4 rtl:-scale-x-100" aria-hidden />
              {t('previous')}
            </Link>
          </Button>
        )}
        {page < pageCount && (
          <Button asChild variant="secondary" size="sm">
            <Link href={pageHref(page + 1)} prefetch={false} rel="next">
              {t('next')}
              <ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden />
            </Link>
          </Button>
        )}
      </div>
    </nav>
  );
}
