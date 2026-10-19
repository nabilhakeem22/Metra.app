import { Link } from '@/i18n/routing';
import { formatNumber } from '@/lib/format/number';
import { marketBookSearch } from '@/lib/market-book/page-params';
import type { MarketCategory } from '@/lib/market-book/types';
import { cn } from '@/lib/utils';

const nameIn = (category: MarketCategory, locale: string) => (locale.startsWith('ar') ? category.nameAr : category.nameEn);

/**
 * The bulletin's categories in the order studios decided (interior first), each
 * leaf a link to its list. Only categories holding an item the studio can see
 * are shown. A server component: links, no state.
 */
export function MarketCategoryRail({ categories, current, locale, label }: { categories: MarketCategory[]; current: string | null; locale: string; label: string }) {
  const tops = categories.filter((category) => category.parentKey === null && category.itemCount > 0);
  return (
    <nav aria-label={label} className="max-h-72 space-y-3 overflow-y-auto rounded-item border p-3 lg:sticky lg:top-4 lg:max-h-[calc(100vh-8rem)]">
      {tops.map((top) => (
        <div key={top.key} className="space-y-1">
          <h2 className="text-caption font-semibold text-muted-foreground">{nameIn(top, locale)}</h2>
          <ul className="space-y-0.5">
            {categories
              .filter((leaf) => leaf.parentKey === top.key && leaf.itemCount > 0)
              .map((leaf) => (
                <li key={leaf.key}>
                  <Link
                    href={`/market-book${marketBookSearch({ categoryKey: leaf.key, query: '' })}`}
                    aria-current={leaf.key === current ? 'page' : undefined}
                    className={cn(
                      'flex items-center justify-between gap-2 rounded-item px-2 py-1 text-body hover:bg-[color:var(--track)]',
                      leaf.key === current && 'bg-brand-tint font-medium text-brand-ink',
                    )}
                  >
                    <span>{nameIn(leaf, locale)}</span>
                    <span className="text-caption text-muted-foreground tabular-nums">{formatNumber(leaf.itemCount, locale)}</span>
                  </Link>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
