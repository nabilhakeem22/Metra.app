import { act, fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { formatMonth } from '@/lib/format/date';
import { formatMoney } from '@/lib/format/money';
import { formatNumber } from '@/lib/format/number';
import type { MarketPriceRef, PriceBookMarketColumn } from '@/lib/market-book/types';
import { pickOption } from '@/test/pick-option';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { CostItemForm } from './cost-item-form';
import { MarketLinkField } from './market-link-field';
import { PriceBookTable } from './price-book-table';
import type { PriceBookItem } from './types';

// Market plan task 18 (Stage 2 PR B3.3): the price book's Market column (AC 15,
// AC 18) and the link combobox. Reference only: the link saves on its own and
// a refusal is said under the picker.

const market = vi.hoisted(() => ({ linkCostItemToMarket: vi.fn(), searchMarketLinks: vi.fn() }));
vi.mock('@/lib/market-book/actions', () => market);
vi.mock('@/lib/price-book/actions', () => ({ createCostItem: vi.fn(), updateCostItem: vi.fn() }));
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ toast }));

const SECTION = { id: 's-1', key: null, nameEn: 'Finishes', nameAr: 'تشطيبات' };
const item = (id: string, marketItemId: string | null): PriceBookItem => ({
  id, code: `C-${id}`, nameEn: `Item ${id}`, nameAr: null, sectionId: SECTION.id, unit: 'sqm',
  defaultUnitCost: '420.0000', defaultUnitPrice: '450.0000', taxCode: null, etaItemCode: null, etaCodeType: null, active: true, marketItemId,
});
const TILE: MarketPriceRef = {
  marketItemId: 'm-1', nameAr: 'بلاط', nameEn: 'Tile', unit: 'sqm', unitLabelAr: 'م2', price: '400.0000', month: '2026-07', variancePct: '5.0', reason: 'ok',
};
const BULLETIN = { periodMonth: '2026-07', publishedAt: '2026-08-01T00:00:00Z', collectionFromDay: 1, collectionToDay: 10, regionKey: 'greater_cairo' };

/** The edit sheet as the page drives it: a bulletin published later, then a refresh handing a new item object of the same id. */
function EditSheet() {
  const [column, setColumn] = useState<{ ref: MarketPriceRef | undefined } | null>(null);
  const [edited, setEdited] = useState(item('linked', 'm-1'));
  return (
    <>
      <button type="button" onClick={() => setColumn({ ref: TILE })}>publish</button>
      <button type="button" onClick={() => setEdited({ ...edited, marketItemId: 'm-2' })}>refresh</button>
      <CostItemForm open onOpenChange={() => {}} item={edited} sections={[SECTION]} market={column} />
    </>
  );
}

function renderTable(locale: TestLocale, column: PriceBookMarketColumn) {
  const rows = [item('linked', 'm-1'), item('own', null)];
  renderWithIntl(
    <PriceBookTable groups={[{ section: SECTION, rows, matched: 2 }]} market={column} canManage={false} pending={false} onEdit={() => {}} onToggleActive={() => {}} />,
    { locale },
  );
}

beforeEach(() => {
  market.linkCostItemToMarket.mockReset();
  market.searchMarketLinks.mockReset();
  market.searchMarketLinks.mockResolvedValue({
    ok: true,
    data: { items: [{ id: 'm-2', nameAr: 'بلاط مط', nameEn: 'Matt tile', leafNameAr: 'بلاط', leafNameEn: 'Tiles', unitCost: '410.0000' }], more: false },
  });
  toast.mockReset();
});

describe.each<TestLocale>(['en', 'ar-EG'])('the Market column (%s)', (locale) => {
  const at = (key: string) => messageAt(locale, key);

  test('shows +5.0% and the market month for a linked item, a dash for an unlinked one (AC 15)', () => {
    renderTable(locale, { bulletin: BULLETIN, refs: { linked: TILE } });
    expect(screen.getByRole('columnheader', { name: at('priceBook.market.column') })).toBeTruthy();
    expect(screen.getByText(`${formatNumber('5.0', locale, { minimumFractionDigits: 1, signDisplay: 'exceptZero' })}%`)).toBeTruthy();
    expect(screen.getByText(formatMonth('2026-07', locale))).toBeTruthy();
    expect(screen.getByTitle(at('priceBook.market.unlinked'))).toBeTruthy();
  });

  test('is not rendered at all while no bulletin is published (AC 18)', () => {
    renderTable(locale, { bulletin: null, refs: {} });
    expect(screen.queryByRole('columnheader', { name: at('priceBook.market.column') })).toBeNull();
    expect(screen.queryByTitle(at('priceBook.market.unlinked'))).toBeNull();
  });

  test('links on a pick, unlinks with one button, and says a refusal under the picker', async () => {
    market.linkCostItemToMarket.mockResolvedValueOnce({ ok: false, error: 'market_unit_incompatible' }).mockResolvedValue({ ok: true });
    renderWithIntl(<MarketLinkField costItemId="c-1" linked reference={TILE} />, { locale });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(market.searchMarketLinks).toHaveBeenCalledWith({ costItemId: 'c-1', query: '' });
    await pickOption('ci-market', `${locale === 'en' ? 'Matt tile (Tiles)' : 'بلاط مط (بلاط)'} ${formatMoney('410.0000', locale)}`);
    expect(market.linkCostItemToMarket).toHaveBeenCalledWith({ costItemId: 'c-1', marketItemId: 'm-2' });
    expect(document.getElementById('ci-market-error')?.textContent).toBe(at('errors.market_unit_incompatible'));
    expect(document.getElementById('ci-market')?.getAttribute('aria-describedby')).toBe('ci-market-error');
    await act(async () => {
      screen.getByRole('button', { name: at('priceBook.market.link.unlink') }).click();
    });
    expect(market.linkCostItemToMarket).toHaveBeenLastCalledWith({ costItemId: 'c-1', marketItemId: null });
    expect(toast).toHaveBeenCalledWith({ title: at('priceBook.market.link.unlinked') });
  });

  test('the edit sheet offers the link only while a bulletin is published, and a refresh keeps what is typed', async () => {
    renderWithIntl(<EditSheet />, { locale });
    expect(screen.queryByText(at('priceBook.market.link.hint'))).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'publish', hidden: true }));
    expect(screen.getByText(at('priceBook.market.link.hint'))).toBeTruthy();
    fireEvent.change(document.getElementById('ci-code')!, { target: { value: 'TYPED' } });
    fireEvent.click(screen.getByRole('button', { name: 'refresh', hidden: true }));
    expect((document.getElementById('ci-code') as HTMLInputElement).value).toBe('TYPED');
  });
});
