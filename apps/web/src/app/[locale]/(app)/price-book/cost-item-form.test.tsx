import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fieldsFailed } from '@/lib/actions/field-errors';
import type { ActionResult } from '@/lib/actions/result';
import { COST_ITEM_FIELDS } from '@/lib/price-book/fields';
import { expectFieldErrorsRenderUnderFields } from '@/test/field-coverage';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { CostItemForm } from './cost-item-form';
import { COST_ITEM_CONTROL_ID } from './cost-item-form-fields';

const actions = vi.hoisted(() => ({ createCostItem: vi.fn(), updateCostItem: vi.fn() }));
vi.mock('@/lib/price-book/actions', () => actions);
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ toast }));
// The edit sheet's market link: its actions are not what these tests are about.
vi.mock('@/lib/market-book/actions', () => ({ linkCostItemToMarket: vi.fn(), searchMarketLinks: vi.fn() }));

const SECTIONS = [{ id: 's-1', key: 'civil', nameEn: 'Civil', nameAr: 'مدني' }];

function renderForm(locale: TestLocale) {
  document.documentElement.dir = locale === 'ar-EG' ? 'rtl' : 'ltr';
  renderWithIntl(<CostItemForm open onOpenChange={() => {}} sections={SECTIONS} market={null} />, { locale });
}

function type(controlId: string, value: string) {
  fireEvent.change(document.getElementById(controlId)!, { target: { value } });
}

async function save(locale: TestLocale) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: messageAt(locale, 'priceBook.form.save') }));
  });
}

/** A valid item, so Save reaches the (mocked) server. */
function fillValid() {
  type('ci-code', 'PB-1');
  type('ci-nameEn', 'Gypsum board');
}

beforeEach(() => {
  actions.createCostItem.mockReset();
  toast.mockReset();
});

describe.each<TestLocale>(['en', 'ar-EG'])('CostItemForm (%s)', (locale) => {
  const at = (key: string) => messageAt(locale, key);
  const under = (controlId: string) => document.getElementById(`${controlId}-error`)?.textContent;

  test('every field the server refuses is said under its own control', async () => {
    renderForm(locale);
    fillValid();
    await expectFieldErrorsRenderUnderFields({
      fields: COST_ITEM_FIELDS,
      controlIdOf: (field) => COST_ITEM_CONTROL_ID[field],
      answerWith: (result: ActionResult) => actions.createCostItem.mockResolvedValue(result),
      submit: () => save(locale),
      locale,
      typed: { 'ci-code': 'PB-1', 'ci-nameEn': 'Gypsum board' },
    });
  });

  test('empty code and names are refused under their fields before anything is sent', async () => {
    renderForm(locale);
    type('ci-cost', '1,5');
    await save(locale);
    expect(actions.createCostItem).not.toHaveBeenCalled();
    expect(under('ci-code')).toBe(at('errors.code_required'));
    expect(under('ci-nameEn')).toBe(at('errors.name_required'));
    expect(document.getElementById('ci-nameAr')!.getAttribute('aria-describedby')).toContain('ci-nameEn-error');
    expect(under('ci-cost')).toBe(at('errors.field.not_a_number'));
    expect(document.activeElement?.id).toBe('ci-code');
  });

  test('a code another item already has is said under Code', async () => {
    actions.createCostItem.mockResolvedValue(fieldsFailed({ code: { code: 'code_taken' } }));
    renderForm(locale);
    fillValid();
    await save(locale);
    expect(under('ci-code')).toBe(at('errors.code_taken'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(toast).not.toHaveBeenCalled();
    type('ci-code', 'PB-2');
    expect(under('ci-code')).toBeUndefined();
  });

  test('a failure with no field is said above the footer with its reference', async () => {
    actions.createCostItem.mockResolvedValue({ ok: false, error: 'generic', reference: 'K7Q29MXD' });
    renderForm(locale);
    fillValid();
    await save(locale);
    expect(screen.getByRole('alert').textContent).toContain('K7Q29MXD');
  });

  test('a saved item closes with the success toast', async () => {
    actions.createCostItem.mockResolvedValue({ ok: true });
    renderForm(locale);
    fillValid();
    await save(locale);
    expect(actions.createCostItem).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'PB-1', nameEn: 'Gypsum board', sectionId: 's-1' }),
    );
    expect(toast).toHaveBeenCalledWith({ title: at('priceBook.toast.created') });
  });
});
