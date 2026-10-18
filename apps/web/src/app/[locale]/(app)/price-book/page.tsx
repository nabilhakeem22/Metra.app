import { getLocale, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { requireOrg } from '@/lib/auth/require-org';
import { can } from '@/lib/permissions/can';
import { readPriceBookView } from '@/lib/price-book/page-params';
import { listPriceBookPage } from '@/lib/price-book/page-query';
import { listSections } from '@/lib/sections/queries';
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
  const [t, locale] = await Promise.all([getTranslations('priceBook'), getLocale()]);
  const [book, sectionRows]: [PriceBookPageData, Awaited<ReturnType<typeof listSections>>] = await Promise.all([
    listPriceBookPage(ctx, view, locale),
    listSections(ctx),
  ]);
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
      <PageHeader title={t('title')} description={t('subtitle')} />
      <PriceBookClient view={view} book={book} sections={sections} canManage={canManage} />
    </div>
  );
}
