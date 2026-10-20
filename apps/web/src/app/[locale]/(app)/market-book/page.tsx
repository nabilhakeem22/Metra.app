import { getLocale, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { requireOrg } from '@/lib/auth/require-org';
import { readMarketBookView } from '@/lib/market-book/page-params';
import { readMarketBookPage } from '@/lib/market-book/queries';
import { marketSearchRefusal } from '@/lib/market-book/search-budget';
import { can } from '@/lib/permissions/can';
import { listSections } from '@/lib/sections/queries';
import { MarketAttribution } from './market-attribution';
import { MarketBookClient } from './market-book-client';
import { MarketBookPager } from './market-book-pager';
import { MarketCategoryRail } from './market-category-rail';
import { marketRowView } from './market-row-view';
import { MarketSearch } from './market-search';
import { MarketSearchRefused } from './market-search-refused';

/**
 * The official market price book (دليل أسعار السوق): one category or one
 * search per render, read in one statement, so the page costs the same however
 * large the book grows. A search is on the member's search budget; past it,
 * the page says so and reads nothing. Readers of the price book read it;
 * owners and admins may add an item to their own price book.
 */
export default async function MarketBookPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireOrg();
  // Read gate as the price book's: site_engineer, client and viewer 404.
  if (!can(ctx.role, 'price_book', 'read')) notFound();

  const view = readMarketBookView(await searchParams);
  const canAdd = can(ctx.role, 'price_book', 'create');
  const [t, locale] = await Promise.all([getTranslations('marketBook'), getLocale()]);
  const header = <PageHeader title={t('title')} description={t('subtitle')} />;

  const refusal = await marketSearchRefusal(ctx, view);
  if (refusal) {
    return (
      <div className="space-y-6">
        {header}
        <MarketSearch query={view.query} />
        <MarketSearchRefused refusal={refusal} />
      </div>
    );
  }

  const [page, sectionRows] = await Promise.all([readMarketBookPage(ctx, view, locale), canAdd ? listSections(ctx) : []]);

  if (!page.bulletin) {
    return (
      <div className="space-y-6">
        {header}
        <Card>
          <CardContent className="py-4">
            <EmptyState title={t('empty.title')} description={t('empty.body')} />
          </CardContent>
        </Card>
      </div>
    );
  }

  const bulletin = page.bulletin;
  const attribution = <MarketAttribution bulletin={bulletin} locale={locale} />;
  return (
    <div className="space-y-6">
      {header}
      <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <MarketCategoryRail categories={page.categories} current={page.categoryKey} locale={locale} label={t('railLabel')} />
        <div className="min-w-0 space-y-4">
          <MarketSearch query={view.query} />
          <MarketBookClient
            items={page.items.map((row) => marketRowView(row, bulletin.periodMonth))}
            matched={page.matched}
            categoryKey={page.categoryKey}
            query={view.query}
            categories={page.categories}
            sections={sectionRows.map(({ id, key, nameAr, nameEn }) => ({ id, key, nameAr, nameEn }))}
            canAdd={canAdd}
            attribution={attribution}
          />
          {page.categoryKey && <MarketBookPager categoryKey={page.categoryKey} page={page.page} matched={page.matched} locale={locale} />}
          {attribution}
        </div>
      </div>
    </div>
  );
}
