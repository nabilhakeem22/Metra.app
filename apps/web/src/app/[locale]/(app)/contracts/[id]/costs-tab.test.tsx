import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { CostEntriesPage, CostEntryRow } from '@/lib/execution/costs/types';
import { openMenu } from '@/test/open-menu';
import { pickOption } from '@/test/pick-option';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { CostsTab } from './costs-tab';

// PR B3.2: the Costs tab asks the server for its list when it opens (the
// contract page never carries it), asks again for a filter, the next page or
// after a write, shows the market price only where the read joined one, and
// voids after a confirm. Fix round: edit and void only on the rows this member
// may change, a reload after a write asks again for every page shown, the
// sections come a page at a time, and an edit shows money as typed.

const actions = vi.hoisted(() => ({
  createCostEntry: vi.fn(),
  updateCostEntry: vi.fn(),
  voidCostEntry: vi.fn(),
  loadCostEntries: vi.fn(),
  loadCostSections: vi.fn(),
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
  costItemId: null, costItemCode: null, costItemNameAr: null, costItemNameEn: null, voided: false, editable: true, market: null,
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
const ALL = { category: null, sectionId: null };

async function renderTab(locale: TestLocale, contractStatus: 'draft' | 'signed' = 'signed') {
  renderWithIntl(<CostsTab contractId="k-1" contractStatus={contractStatus} canCreate canPickCostItem m={(value) => value} />, { locale });
  await act(async () => {});
}

beforeEach(() => {
  for (const action of Object.values(actions)) action.mockReset();
  actions.loadCostEntries.mockResolvedValue({ ok: true, data: FIRST });
  actions.loadCostSections.mockResolvedValue({ ok: true, data: { sections: [{ id: 's-1', titleAr: 'مدني', titleEn: 'Civil' }], hasMore: false } });
  actions.searchCostEntryLines.mockResolvedValue({ ok: true, data: { lines: [], hasMore: false } });
  toast.mockReset();
});

describe.each<TestLocale>(['en', 'ar-EG'])('CostsTab (%s)', (locale) => {
  const at = (key: string) => messageAt(locale, key);

  test('asks for the first page when it opens, then shows the market price beside a matched entry only', async () => {
    await renderTab(locale);
    expect(actions.loadCostEntries).toHaveBeenCalledWith({ contractId: 'k-1', filter: ALL, cursor: null });
    expect(screen.getAllByText(at('contracts.costs.market').replace('{price}', '400.0000'))).toHaveLength(1);
    expect(screen.getByText(at('contracts.costs.voided'))).toBeTruthy();
    expect(screen.getAllByRole('button', { name: at('common.moreActions') })).toHaveLength(1);
  });

  test('says it is loading until the first answer', async () => {
    let answer: (page: unknown) => void = () => {};
    actions.loadCostEntries.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    await renderTab(locale);
    expect(screen.getByText(at('contracts.costs.loading'))).toBeTruthy();
    // Settled, so no async transition is left pending for the next test to be entangled with.
    await act(async () => answer({ ok: true, data: FIRST }));
    expect(screen.queryByText(at('contracts.costs.loading'))).toBeNull();
  });

  test('says why a first load failed, and no longer that it is loading', async () => {
    actions.loadCostEntries.mockResolvedValue({ ok: false, error: 'generic', reference: 'ref-1' });
    await renderTab(locale);
    expect(screen.getByRole('alert').textContent).toContain(at('contracts.costs.loadFailed'));
    expect(screen.queryByText(at('contracts.costs.loading'))).toBeNull();
  });

  test('asks for the next page after the last entry shown, and appends it', async () => {
    await renderTab(locale);
    actions.loadCostEntries.mockResolvedValue({ ok: true, data: { entries: [row(3)], next: null, totals: null } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: at('contracts.costs.showMore') }));
    });
    expect(actions.loadCostEntries).toHaveBeenLastCalledWith({ contractId: 'k-1', filter: ALL, cursor: FIRST.next });
    expect(screen.getByText('Entry 1')).toBeTruthy();
    expect(screen.getByText('Entry 3')).toBeTruthy();
    expect(screen.queryByRole('button', { name: at('contracts.costs.showMore') })).toBeNull();
  });

  test('a category asks the server for its first page and its total', async () => {
    await renderTab(locale);
    actions.loadCostEntries.mockResolvedValue({ ok: true, data: { entries: [], next: null, totals: { count: 0, amount: '0.0000' } } });
    await pickOption('costs-filter-category', at('contracts.costs.categories.labour'));
    expect(actions.loadCostEntries).toHaveBeenLastCalledWith({ contractId: 'k-1', filter: { category: 'labour', sectionId: null }, cursor: null });
    expect(screen.getByText(at('contracts.costs.noMatch'))).toBeTruthy();
  });

  test('voids only after the confirm, says a refusal, and asks for the list again', async () => {
    actions.voidCostEntry.mockResolvedValue({ ok: false, error: 'cost_entry_voided' });
    await renderTab(locale);
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
    expect(actions.loadCostEntries).toHaveBeenCalledTimes(2);
  });

  test('offers no Record on a draft contract, and says why', async () => {
    await renderTab(locale, 'draft');
    expect(screen.queryByRole('button', { name: at('contracts.costs.record') })).toBeNull();
    expect(screen.getByText(at('contracts.costs.draftNote'))).toBeTruthy();
  });

  test('offers edit and void only on a row this member may change', async () => {
    actions.loadCostEntries.mockResolvedValue({ ok: true, data: { entries: [row(1, { editable: false }), row(3)], next: null, totals: { count: 2, amount: '200.0000' } } });
    await renderTab(locale);
    expect(screen.getAllByRole('button', { name: at('common.moreActions') })).toHaveLength(1);
  });

  test('after a void, asks again for every page shown, so the row stays in view', async () => {
    const second: CostEntriesPage = { entries: [row(3)], next: null, totals: null };
    actions.voidCostEntry.mockResolvedValue({ ok: true });
    await renderTab(locale);
    actions.loadCostEntries.mockResolvedValueOnce({ ok: true, data: second });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: at('contracts.costs.showMore') }));
    });
    actions.loadCostEntries.mockClear();
    actions.loadCostEntries.mockResolvedValueOnce({ ok: true, data: FIRST }).mockResolvedValueOnce({ ok: true, data: { ...second, entries: [row(3, { voided: true })] } });
    const menus = screen.getAllByRole('button', { name: at('common.moreActions') });
    fireEvent.pointerDown(menus[menus.length - 1], { button: 0, ctrlKey: false, pointerType: 'mouse' });
    await act(async () => {
      fireEvent.click(await screen.findByRole('menuitem', { name: at('contracts.costs.void') }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: at('contracts.costs.voidConfirm.confirm') }));
    });
    expect(actions.voidCostEntry).toHaveBeenCalledWith(row(3).id);
    expect(actions.loadCostEntries.mock.calls.map(([request]) => (request as { cursor: unknown }).cursor)).toEqual([null, FIRST.next]);
    expect(screen.getByText('Entry 3')).toBeTruthy();
    expect(screen.queryByRole('button', { name: at('contracts.costs.showMore') })).toBeNull();
  });

  test('lists the sections a page at a time, asked when it opens', async () => {
    actions.loadCostSections.mockResolvedValueOnce({ ok: true, data: { sections: [{ id: 's-1', titleAr: 'مدني', titleEn: 'Civil' }], hasMore: true } });
    await renderTab(locale);
    expect(actions.loadCostSections).toHaveBeenCalledWith({ contractId: 'k-1', afterSectionId: null });
    actions.loadCostSections.mockResolvedValueOnce({ ok: true, data: { sections: [{ id: 's-2', titleAr: 'كهرباء', titleEn: 'Electrical' }], hasMore: false } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: at('contracts.costs.moreSections') }));
    });
    expect(actions.loadCostSections).toHaveBeenLastCalledWith({ contractId: 'k-1', afterSectionId: 's-1' });
    expect(screen.queryByRole('button', { name: at('contracts.costs.moreSections') })).toBeNull();
    await pickOption('costs-filter-section', locale === 'en' ? 'Electrical' : 'كهرباء');
    expect(actions.loadCostEntries).toHaveBeenLastCalledWith({ contractId: 'k-1', filter: { category: null, sectionId: 's-2' }, cursor: null });
  });

  test('an edit shows the money as typed, not at four decimals', async () => {
    actions.loadCostEntries.mockResolvedValue({
      ok: true,
      data: { entries: [row(1, { amount: '410.0000', qty: '2.5000', unit: 'sqm', unitCost: '164.0000' })], next: null, totals: { count: 1, amount: '410.0000' } },
    });
    await renderTab(locale);
    openMenu(at('common.moreActions'));
    await act(async () => {
      fireEvent.click(await screen.findByRole('menuitem', { name: at('contracts.costs.edit') }));
    });
    expect((document.getElementById('ce-amount') as HTMLInputElement).value).toBe('410');
    expect((document.getElementById('ce-qty') as HTMLInputElement).value).toBe('2.5');
    expect((document.getElementById('ce-unit-cost') as HTMLInputElement).value).toBe('164');
  });
});
