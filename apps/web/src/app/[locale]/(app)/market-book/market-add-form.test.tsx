import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fieldsFailed } from '@/lib/actions/field-errors';
import type { ActionResult } from '@/lib/actions/result';
import { ADD_MARKET_ITEM_FIELDS } from '@/lib/market-book/add-input';
import type { MarketItemRow } from '@/lib/market-book/types';
import { expectFieldErrorsRenderUnderFields } from '@/test/field-coverage';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { MARKET_ADD_CONTROL_ID, MarketAddForm } from './market-add-form';
import { marketRowView } from './market-row-view';

const actions = vi.hoisted(() => ({ addMarketItemToPriceBook: vi.fn(), loadMarketItem: vi.fn() }));
vi.mock('@/lib/market-book/actions', () => actions);
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ toast }));

const SECTIONS = [
  { id: 's-1', key: 'civil', nameEn: 'Civil', nameAr: 'مدني' },
  { id: 's-glass', key: 'market.finishing.glass', nameEn: 'Glass', nameAr: 'الزجاج' },
];

const GLASS = marketRowView({
  id: 'm-1', key: 'finishing.glass.clear_4mm', categoryKey: 'finishing.glass',
  nameAr: 'زجاج شفاف', nameEn: 'Clear glass', specAr: '4 مم', specEn: '4 mm',
  unit: 'sqm', unitLabelAr: 'م2', basisNoteAr: null, status: 'active',
  latest: { month: '2026-07', status: 'priced', price: '400.0000', bulletinMonth: '2026-07', sourcePage: 65 },
  series: [{ month: '2026-07', status: 'priced', price: '400.0000', bulletinMonth: '2026-07', sourcePage: 65 }],
  momPct: null, ytdPct: null, yoyPct: null, linkedCostItem: null,
} satisfies MarketItemRow);

const onClose = vi.fn();

function renderForm(locale: TestLocale) {
  document.documentElement.dir = locale === 'ar-EG' ? 'rtl' : 'ltr';
  renderWithIntl(<MarketAddForm item={GLASS} sections={SECTIONS} onClose={onClose} />, { locale });
}

const control = (field: keyof typeof MARKET_ADD_CONTROL_ID) => document.getElementById(MARKET_ADD_CONTROL_ID[field]) as HTMLInputElement;
const under = (field: keyof typeof MARKET_ADD_CONTROL_ID) => document.getElementById(`${MARKET_ADD_CONTROL_ID[field]}-error`)?.textContent;

async function save(locale: TestLocale) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: messageAt(locale, 'marketBook.addForm.save') }));
  });
}

beforeEach(() => {
  actions.addMarketItemToPriceBook.mockReset();
  toast.mockReset();
  onClose.mockReset();
});

describe.each<TestLocale>(['en', 'ar-EG'])('MarketAddForm (%s)', (locale) => {
  const at = (key: string) => messageAt(locale, key);

  test('offers the seed code, the name with its spec, the seeded section, and shows the cost it will save', () => {
    renderForm(locale);
    expect(control('code').value).toBe('MKT-finishing.glass.clear_4mm');
    expect((document.getElementById('ma-nameEn') as HTMLInputElement).value).toBe('Clear glass 4 mm');
    expect((document.getElementById('ma-nameAr') as HTMLInputElement).value).toBe('زجاج شفاف 4 مم');
    expect(control('sectionId').textContent).toContain(locale === 'en' ? 'Glass' : 'الزجاج');
    expect(document.body.textContent).toContain('400.00');
  });

  test('every field the server refuses is said under its own control', async () => {
    renderForm(locale);
    await expectFieldErrorsRenderUnderFields({
      fields: ADD_MARKET_ITEM_FIELDS,
      controlIdOf: (field) => MARKET_ADD_CONTROL_ID[field],
      answerWith: (result: ActionResult) => actions.addMarketItemToPriceBook.mockResolvedValue(result),
      submit: () => save(locale),
      locale,
    });
  });

  test('an empty code and an unreadable price are refused under their fields before anything is sent', async () => {
    renderForm(locale);
    fireEvent.change(control('code'), { target: { value: ' ' } });
    fireEvent.change(control('defaultUnitPrice'), { target: { value: '1,5' } });
    await save(locale);
    expect(actions.addMarketItemToPriceBook).not.toHaveBeenCalled();
    expect(under('code')).toBe(at('errors.code_required'));
    expect(under('defaultUnitPrice')).toBe(at('errors.field.not_a_number'));
  });

  test('a taken code is said under Code; a unit refusal above the footer', async () => {
    actions.addMarketItemToPriceBook.mockResolvedValue(fieldsFailed({ code: { code: 'code_taken' } }));
    renderForm(locale);
    await save(locale);
    expect(under('code')).toBe(at('errors.code_taken'));
    actions.addMarketItemToPriceBook.mockResolvedValue({ ok: false, error: 'market_unit_incompatible' });
    await save(locale);
    expect(screen.getByRole('alert').textContent).toBe(at('errors.market_unit_incompatible'));
    expect(onClose).not.toHaveBeenCalled();
  });

  test('an added item closes with the toast, sending the market item and the seeded section', async () => {
    actions.addMarketItemToPriceBook.mockResolvedValue({ ok: true });
    renderForm(locale);
    await save(locale);
    expect(actions.addMarketItemToPriceBook).toHaveBeenCalledWith(
      expect.objectContaining({ marketItemId: 'm-1', code: 'MKT-finishing.glass.clear_4mm', sectionId: 's-glass', defaultUnitPrice: '' }),
    );
    expect(toast).toHaveBeenCalledWith({ title: at('marketBook.addForm.added') });
    expect(onClose).toHaveBeenCalled();
  });
});
