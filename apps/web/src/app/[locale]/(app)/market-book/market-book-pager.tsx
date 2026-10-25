import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/routing';
import { formatNumber } from '@/lib/format/number';
import { MARKET_PAGE_SIZE, marketBookSearch } from '@/lib/market-book/page-params';

/**
 * Which items of the category this page shows, and real links (?page=) to the
 * pages either side, not prefetched (each prefetch is one more render nobody
 * may open). A category of one page renders nothing. A server component.
 */
export async function MarketBookPager({ categoryKey, page, matched, locale }: { categoryKey: string; page: number; matched: number; locale: string }) {
  const pageCount = Math.ceil(matched / MARKET_PAGE_SIZE);
  if (pageCount <= 1) return null;
  const t = await getTranslations('marketBook.pager');
  const pageHref = (target: number) => `/market-book${marketBookSearch({ categoryKey, query: '', page: target })}`;
  return (
    <nav aria-label={t('label')} className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-caption text-muted-foreground">
        {t('range', {
          from: formatNumber((page - 1) * MARKET_PAGE_SIZE + 1, locale),
          to: formatNumber(Math.min(page * MARKET_PAGE_SIZE, matched), locale),
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
