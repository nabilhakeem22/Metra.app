import { screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { formatMoney } from '@/lib/format/money';
import type { MarketPriceRef } from '@/lib/market-book/types';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { PriceBookTable } from './price-book-table';
import type { PriceBookItem } from './types';

// Go-live security fix round, T1: a reader who may not see margin (a project
// manager while the studio hides margin from PMs) gets the book with no unit
// cost read at all. The table then has no Cost column, and the Market cell
// keeps the public price and month but no variance (beside the price it would
// give the cost away). tests/actions/price-book-page-margin.dbtest.ts proves
// the server sends no cost; this proves the table asks for none.

const SECTION = { id: 's-1', key: null, nameEn: 'Finishes', nameAr: 'تشطيبات' };
const BULLETIN = { periodMonth: '2026-07', publishedAt: '2026-08-01T00:00:00Z', collectionFromDay: 1, collectionToDay: 10, regionKey: 'greater_cairo' };
const row = (defaultUnitCost: string | null): PriceBookItem => ({
  id: 'tile', code: 'C-1', nameEn: 'Tile', nameAr: 'بلاط', sectionId: SECTION.id, unit: 'sqm', defaultUnitCost,
  defaultUnitPrice: '450.0000', taxCode: null, etaItemCode: null, etaCodeType: null, active: true, marketItemId: 'm-1',
});
const reference = (variancePct: string | null): MarketPriceRef => ({
  marketItemId: 'm-1', nameAr: 'بلاط', nameEn: 'Tile', unit: 'sqm', unitLabelAr: 'م2', price: '400.0000', month: '2026-07', variancePct, reason: 'ok',
});

function renderBook(locale: TestLocale, showsCost: boolean) {
  const item = row(showsCost ? '777.4321' : null);
  const ref = reference(showsCost ? '5.0' : null);
  return renderWithIntl(
    <PriceBookTable
      groups={[{ section: SECTION, rows: [item], matched: 1 }]}
      market={{ bulletin: BULLETIN, refs: { tile: ref } }}
      canManage={false}
      showsCost={showsCost}
      pending={false}
      onEdit={() => {}}
      onToggleActive={() => {}}
    />,
    { locale },
  );
}

describe.each<TestLocale>(['en', 'ar-EG'])('the price book for a reader who may not see margin (%s)', (locale) => {
  const costHeader = () => screen.queryByRole('columnheader', { name: messageAt(locale, 'priceBook.table.cost') });

  test('has no Cost column and no variance, and still shows the price and the market price', () => {
    const { container } = renderBook(locale, false);
    expect(costHeader()).toBeNull();
    expect(screen.getAllByRole('columnheader')).toHaveLength(6);
    expect(screen.getAllByRole('cell')).toHaveLength(6);
    expect(container.textContent).toContain(formatMoney('450.0000', locale));
    expect(container.textContent).toContain(formatMoney('400.0000', locale));
    expect(container.textContent).not.toContain('%');
  });

  test('a reader who may see margin keeps the Cost column and the variance (control)', () => {
    const { container } = renderBook(locale, true);
    expect(costHeader()).not.toBeNull();
    expect(screen.getAllByRole('cell')).toHaveLength(7);
    expect(container.textContent).toContain(formatMoney('777.4321', locale));
    expect(container.textContent).toContain('%');
  });
});
