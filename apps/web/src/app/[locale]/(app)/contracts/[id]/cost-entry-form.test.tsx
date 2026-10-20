import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ActionResult } from '@/lib/actions/result';
import { COST_ENTRY_FIELDS } from '@/lib/execution/costs/input';
import { expectFieldErrorsRenderUnderFields } from '@/test/field-coverage';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { CostEntryForm } from './cost-entry-form';
import { COST_ENTRY_CONTROL_ID } from './cost-entry-form-state';
import { useCostEntryForm } from './use-cost-entry-form';

// PR B3.2: the cost entry sheet says every refusal under its own box (AC 19 of
// the field-errors plan), checks the typed values before sending, and keeps
// one idempotency key across a retried Save.

const actions = vi.hoisted(() => ({
  createCostEntry: vi.fn(),
  updateCostEntry: vi.fn(),
  voidCostEntry: vi.fn(),
  loadCostEntries: vi.fn(),
  searchCostEntryLines: vi.fn(),
}));
vi.mock('@/lib/execution/costs/actions', () => actions);
vi.mock('@/lib/price-book/picker-actions', () => ({
  searchPriceBookPicker: vi.fn().mockResolvedValue({ ok: true, data: { items: [], matched: 0 } }),
}));
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ toast }));

const SECTIONS = [{ id: 's-1', titleAr: 'مدني', titleEn: 'Civil', sortOrder: 0, sectionSubtotal: '0', lineCount: 0, openingLines: [] }];

function Sheet() {
  const entry = useCostEntryForm('k-1', () => {});
  return (
    <>
      <button type="button" onClick={entry.openNew}>
        open
      </button>
      <CostEntryForm contractId="k-1" sections={SECTIONS} entry={entry} />
    </>
  );
}

async function openSheet(locale: TestLocale) {
  document.documentElement.dir = locale === 'ar-EG' ? 'rtl' : 'ltr';
  renderWithIntl(<Sheet />, { locale });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'open' }));
  });
}

const type = (field: keyof typeof COST_ENTRY_CONTROL_ID, value: string) =>
  fireEvent.change(document.getElementById(COST_ENTRY_CONTROL_ID[field])!, { target: { value } });

beforeEach(() => {
  for (const action of Object.values(actions)) action.mockReset();
  actions.searchCostEntryLines.mockResolvedValue({ ok: true, data: { lines: [], hasMore: false } });
  toast.mockReset();
});

describe.each<TestLocale>(['en', 'ar-EG'])('CostEntryForm (%s)', (locale) => {
  const at = (key: string) => messageAt(locale, key);
  const under = (field: keyof typeof COST_ENTRY_CONTROL_ID) => document.getElementById(`${COST_ENTRY_CONTROL_ID[field]}-error`)?.textContent;
  const save = async () => {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: at('contracts.costs.form.save') }));
    });
  };

  test('every field the server refuses is said under its own control', async () => {
    await openSheet(locale);
    type('description', 'Cement');
    type('amount', '1500');
    await expectFieldErrorsRenderUnderFields({
      fields: COST_ENTRY_FIELDS,
      controlIdOf: (field) => COST_ENTRY_CONTROL_ID[field],
      answerWith: (result: ActionResult) => actions.createCostEntry.mockResolvedValue(result),
      submit: save,
      locale,
      typed: { [COST_ENTRY_CONTROL_ID.description]: 'Cement', [COST_ENTRY_CONTROL_ID.amount]: '1500' },
    });
  });

  test('a blank description, a zero amount and a half-typed quantity are refused before anything is sent', async () => {
    await openSheet(locale);
    type('amount', '0');
    type('qty', '2');
    await save();
    expect(actions.createCostEntry).not.toHaveBeenCalled();
    expect(under('description')).toBe(at('errors.field.required'));
    expect(under('amount')).toBe(messageAt(locale, 'errors.field.out_of_range').replace('{min}', '0.01').replace('{max}', '1,000,000,000,000'));
    expect(under('unit')).toBe(at('errors.field.required'));
    expect(under('unitCost')).toBe(at('errors.field.required'));
    expect(document.activeElement?.id).toBe(COST_ENTRY_CONTROL_ID.description);
  });

  test('a refusal of the whole entry is said above Save, and the retry keeps its key', async () => {
    actions.createCostEntry.mockResolvedValueOnce({ ok: false, error: 'line_not_in_contract' }).mockResolvedValueOnce({ ok: true, already: true });
    await openSheet(locale);
    type('description', 'Cement');
    type('amount', '1,500');
    await save();
    expect(screen.getByRole('alert').textContent).toContain(at('errors.line_not_in_contract'));
    await save();
    const [first, second] = actions.createCostEntry.mock.calls.map(([input]) => input as Record<string, unknown>);
    expect(first).toMatchObject({ contractId: 'k-1', category: 'materials', description: 'Cement', amount: '1,500', contractSectionId: null, qty: null });
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(toast).toHaveBeenCalledWith({ title: at('contracts.costs.toast.already') });
  });
});
