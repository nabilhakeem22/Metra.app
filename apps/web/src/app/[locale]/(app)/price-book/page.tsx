import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { requireOrg } from '@/lib/auth/require-org';
import { can } from '@/lib/permissions/can';
import { listCostItems } from '@/lib/price-book/queries';
import { listSections } from '@/lib/sections/queries';
import { PriceBookClient } from './price-book-client';
import type { PriceBookItem, SectionOption } from './types';

export default async function PriceBookPage() {
  const ctx = await requireOrg();
  // Read gate: roles without price_book read (site_engineer/client/viewer) 404.
  if (!can(ctx.role, 'price_book', 'read')) notFound();

  const t = await getTranslations('priceBook');
  const [rows, sectionRows] = await Promise.all([
    listCostItems(ctx, {}),
    listSections(ctx),
  ]);
  const items: PriceBookItem[] = rows.map((i) => ({
    id: i.id,
    code: i.code,
    nameEn: i.nameEn,
    nameAr: i.nameAr,
    sectionId: i.sectionId,
    unit: i.unit,
    defaultUnitCost: i.defaultUnitCost,
    defaultUnitPrice: i.defaultUnitPrice,
    taxCode: i.taxCode,
    etaItemCode: i.etaItemCode,
    etaCodeType: i.etaCodeType,
    active: i.active,
  }));
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
      <PriceBookClient items={items} sections={sections} canManage={canManage} />
    </div>
  );
}
