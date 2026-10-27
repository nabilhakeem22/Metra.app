import { ChartLine } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Link } from '@/i18n/routing';
import { requireOrg } from '@/lib/auth/require-org';
import { readPriceBookView } from '@/lib/price-book/page-params';
import { loadPriceBookPage } from '@/lib/price-book/page-data';
import { MarketAttribution } from '@/app/[locale]/(app)/market-book/market-attribution';
import { PriceBookClient } from './price-book-client';

export default async function PriceBookPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireOrg();
  const view = readPriceBookView(await searchParams);
  const [t, tm, locale] = await Promise.all([getTranslations('priceBook'), getTranslations('marketBook'), getLocale()]);
  // Read gate: roles without price_book read (site_engineer/client/viewer) 404.
  // A reader who may not see margin gets no unit cost (lib/price-book/page-data.ts).
  const props = await loadPriceBookPage(ctx, view, locale);
  if (!props) notFound();

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
      <PriceBookClient view={view} {...props} />
      {props.market.bulletin && props.book.hasAnyItem && <MarketAttribution bulletin={props.market.bulletin} locale={locale} />}
    </div>
  );
}
