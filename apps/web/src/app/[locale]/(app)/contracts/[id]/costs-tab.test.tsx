import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { CostEntriesPage, CostEntryRow } from '@/lib/execution/costs/types';
import { openMenu } from '@/test/open-menu';
import { pickOption } from '@/test/pick-option';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { CostsTab } from './costs-tab';

// PR B3.2: the Costs tab lists what the server read (50 a page), asks the
// server for a filter or the next page, shows the market price only where the
// read joined one, and voids after a confirm.

const actions = vi.hoisted(() => ({
  createCostEntry: vi.fn(),
  updateCostEntry: vi.fn(),
  voidCostEntry: vi.fn(),
  loadCostEntries: vi.fn(),
  searchCostEntryLines: vi.fn(),
}));
vi.mock('@/lib/execution/costs/actions', () => actions);
vi.mock('@/lib/price-book/picker-actions', () => ({ searchPriceBookPicker: vi.fn() }));
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ toast }));

const row = (n: number, extra: Partial<CostEntryRow> = {}): CostEntryRow => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  category: 'materials', description: `Entry ${n}`, amount: '100.0000', incurredOn: '2026-10-01',
  qty: null, unit: null, unitCost: null, supplier: null, reference: null,
  contractSectionId: null, sectionTitleAr: null, sectionTitleEn: null, contractLineId: null, lineDescriptionAr: null, lineDescriptionEn: null,
  costItemId: null, costItemCode: null, costItemNameAr: null, costItemNameEn: null, voided: false, market: null,
  ...extra,
});

const FIRST: CostEntriesPage = {
  entries: [
    row(1, { qty: '2.0000', unit: 'sqm', unitCost: '420.0000', costItemCode: 'G-1', market: { unitCost: '400.0000', variancePct: '5.0' } }),
    row(2, { voided: true }),
  ],
  next: { incurredOn: '2026-10-01', id: row(2).id },
  totals: { count: 1, amount: '100.0000' },
};

function renderTab(locale: TestLocale, contractStatus: 'draft' | 'signed' = 'signed') {
  renderWithIntl(
    <CostsTab contractId="k-1" contractStatus={contractStatus} sections={[]} initial={FIRST} canCreate canUpdate m={(value) => value} />,
    { locale },
  );
}

beforeEach(() => {
  for (const action of Object.values(actions)) action.mockReset();
  toast.mockReset();
});

describe.each<TestLocale>(['en', 'ar-EG'])('CostsTab (%s)', (locale) => {
  const at = (key: string) => messageAt(locale, key);

  test('shows the market price beside a matched entry only, and a voided entry without actions', async () => {
    renderTab(locale);
    expect(screen.getAllByText(at('contracts.costs.market').replace('{price}', '400.0000'))).toHaveLength(1);
    expect(screen.getByText(at('contracts.costs.voided'))).toBeTruthy();
    expect(screen.getAllByRole('button', { name: at('common.moreActions') })).toHaveLength(1);
  });

  test('asks for the next page after the last entry shown, and appends it', async () => {
    actions.loadCostEntries.mockResolvedValue({ ok: true, data: { entries: [row(3)], next: null, totals: null } });
    renderTab(locale);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: at('contracts.costs.showMore') }));
    });
    expect(actions.loadCostEntries).toHaveBeenCalledWith({ contractId: 'k-1', filter: { category: null, sectionId: null }, cursor: FIRST.next });
    expect(screen.getByText('Entry 3')).toBeTruthy();
    expect(screen.queryByRole('button', { name: at('contracts.costs.showMore') })).toBeNull();
  });

  test('a category asks the server for its first page and its total', async () => {
    actions.loadCostEntries.mockResolvedValue({ ok: true, data: { entries: [], next: null, totals: { count: 0, amount: '0.0000' } } });
    renderTab(locale);
    await pickOption('costs-filter-category', at('contracts.costs.categories.labour'));
    expect(actions.loadCostEntries).toHaveBeenCalledWith({ contractId: 'k-1', filter: { category: 'labour', sectionId: null }, cursor: null });
    expect(screen.getByText(at('contracts.costs.noMatch'))).toBeTruthy();
  });

  test('voids only after the confirm, and says a refusal', async () => {
    actions.voidCostEntry.mockResolvedValue({ ok: false, error: 'cost_entry_voided' });
    renderTab(locale);
    openMenu(at('common.moreActions'));
    await act(async () => {
      fireEvent.click(await screen.findByRole('menuitem', { name: at('contracts.costs.void') }));
    });
    expect(actions.voidCostEntry).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: at('contracts.costs.voidConfirm.confirm') }));
    });
    expect(actions.voidCostEntry).toHaveBeenCalledWith(row(1).id);
    expect(toast).toHaveBeenCalledWith({ title: at('errors.cost_entry_voided'), variant: 'destructive' });
  });

  test('offers no Record on a draft contract, and says why', () => {
    renderTab(locale, 'draft');
    expect(screen.queryByRole('button', { name: at('contracts.costs.record') })).toBeNull();
    expect(screen.getByText(at('contracts.costs.draftNote'))).toBeTruthy();
  });
});
