import { ChartLine } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Link } from '@/i18n/routing';
import { requireOrg } from '@/lib/auth/require-org';
import { readMarketColumn } from '@/lib/market-book/price-refs';
import { can } from '@/lib/permissions/can';
import { readPriceBookView } from '@/lib/price-book/page-params';
import { listPriceBookPage } from '@/lib/price-book/page-query';
import { listSections } from '@/lib/sections/queries';
import { MarketAttribution } from '@/app/[locale]/(app)/market-book/market-attribution';
import { PriceBookClient } from './price-book-client';
import type { PriceBookPageData, SectionOption } from './types';

export default async function PriceBookPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireOrg();
  // Read gate: roles without price_book read (site_engineer/client/viewer) 404.
  if (!can(ctx.role, 'price_book', 'read')) notFound();

  const view = readPriceBookView(await searchParams);
  const [t, tm, locale] = await Promise.all([getTranslations('priceBook'), getTranslations('marketBook'), getLocale()]);
  const [book, sectionRows]: [PriceBookPageData, Awaited<ReturnType<typeof listSections>>] = await Promise.all([
    listPriceBookPage(ctx, view, locale),
    listSections(ctx),
  ]);
  // The Market column of this page's items only (at most a page of them).
  const market = await readMarketColumn(ctx, book.rows);
  const sections: SectionOption[] = sectionRows.map((s) => ({
    id: s.id,
    key: s.key,
    nameEn: s.nameEn,
    nameAr: s.nameAr,
  }));

  // owner/admin get CRUA; PM/accountant are read-only.
  const canManage = can(ctx.role, 'price_book', 'create');

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        action={
          <Button variant="secondary" asChild>
            <Link href="/market-book">
              <ChartLine className="size-4" aria-hidden />
              {tm('title')}
            </Link>
          </Button>
        }
      />
      <PriceBookClient view={view} book={book} market={market} sections={sections} canManage={canManage} />
      {market.bulletin && book.hasAnyItem && <MarketAttribution bulletin={market.bulletin} locale={locale} />}
    </div>
  );
}
