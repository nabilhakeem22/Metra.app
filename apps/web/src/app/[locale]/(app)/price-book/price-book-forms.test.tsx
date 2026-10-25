import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ActionResult } from '@/lib/actions/result';
import { expectFieldErrorsRenderUnderFields } from '@/test/field-coverage';
import { pickOption } from '@/test/pick-option';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { BulkUpdateDialog } from './bulk-update-dialog';
import { ImportWizard } from './import-wizard';
import { FIRST_VIEW } from '@/lib/price-book/page-params';
import { PriceBookClient } from './price-book-client';
import type { PriceBookItem } from './types';

// W2.8: the price book's bulk change, import wizard and category box say each
// refusal under the box it is about (AC 19), in both locales.

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('@/i18n/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/routing')>()),
  useRouter: () => router,
}));
const priceBook = vi.hoisted(() => ({
  bulkUpdatePrices: vi.fn(),
  parseCostImport: vi.fn(),
  importCostItems: vi.fn(),
  findExistingCostItemCodes: vi.fn(),
  setCostItemActive: vi.fn(),
  loadMarketPriceBook: vi.fn(),
  createCostItem: vi.fn(),
  updateCostItem: vi.fn(),
}));
vi.mock('@/lib/price-book/actions', () => priceBook);
const sectionActions = vi.hoisted(() => ({ addSection: vi.fn() }));
vi.mock('@/lib/sections/actions', () => sectionActions);
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }));
// The edit sheet's market link: its actions are not what these tests are about.
vi.mock('@/lib/market-book/actions', () => ({ linkCostItemToMarket: vi.fn(), searchMarketLinks: vi.fn() }));

const SECTIONS = [{ id: 's-1', key: 'civil', nameEn: 'Civil', nameAr: 'مدني' }];
const ITEM = {
  id: 'i-1',
  code: 'PB-1',
  nameEn: 'Board',
  nameAr: null,
  sectionId: 's-1',
  unit: 'sqm',
  defaultUnitCost: '1',
  defaultUnitPrice: '2',
  taxCode: null,
  etaItemCode: null,
  etaCodeType: null,
  active: true,
  marketItemId: null,
} as PriceBookItem;

beforeEach(() => {
  for (const action of [...Object.values(priceBook), ...Object.values(sectionActions)]) action.mockReset();
});

describe.each<TestLocale>(['en', 'ar-EG'])('price-book forms (%s)', (locale) => {
  const at = (key: string) => messageAt(locale, key);
  const show = (ui: React.ReactElement) => {
    document.documentElement.dir = locale === 'ar-EG' ? 'rtl' : 'ltr';
    renderWithIntl(ui, { locale });
  };
  const press = (name: string) => async () => {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name }));
    });
  };

  test('bulk change: category and percentage', async () => {
    show(<BulkUpdateDialog open onOpenChange={() => {}} sections={SECTIONS} />);
    await expectFieldErrorsRenderUnderFields({
      fields: ['sectionId', 'pct'],
      controlIdOf: (field) => (field === 'sectionId' ? 'bulk-category' : 'bulk-pct'),
      answerWith: (result: ActionResult) => priceBook.bulkUpdatePrices.mockResolvedValue(result),
      submit: press(at('priceBook.bulk.apply')),
      locale,
    });
  });

  test('bulk change: a percentage out of range is said before anything is sent', async () => {
    show(<BulkUpdateDialog open onOpenChange={() => {}} sections={SECTIONS} />);
    fireEvent.change(document.getElementById('bulk-pct')!, { target: { value: '2000' } });
    await press(at('priceBook.bulk.apply'))();
    expect(priceBook.bulkUpdatePrices).not.toHaveBeenCalled();
    expect(document.getElementById('bulk-pct-error')?.textContent).toBe(
      at('errors.field.out_of_range').replace('{min}', '-100').replace('{max}', '1000'),
    );
  });

  test('import: the file', async () => {
    show(<ImportWizard open onOpenChange={() => {}} sections={SECTIONS} />);
    await expectFieldErrorsRenderUnderFields({
      fields: ['file'],
      controlIdOf: () => 'import-file',
      answerWith: (result: ActionResult) => priceBook.parseCostImport.mockResolvedValue(result),
      submit: async () => {
        await act(async () => {
          fireEvent.change(document.getElementById('import-file')!, {
            target: { files: [new File(['code\n'], 'items.csv', { type: 'text/csv' })] },
          });
        });
      },
      locale,
    });
  });

  test('import: Preview says which required column is unmapped, under it', async () => {
    priceBook.parseCostImport.mockResolvedValue({ ok: true, data: { header: ['Code', 'Other'], data: [] } });
    show(<ImportWizard open onOpenChange={() => {}} sections={SECTIONS} />);
    await act(async () => {
      fireEvent.change(document.getElementById('import-file')!, {
        target: { files: [new File(['code\n'], 'items.csv', { type: 'text/csv' })] },
      });
    });
    await pickOption('map-code', 'Code');
    await press(at('priceBook.import.preview'))();
    expect(document.getElementById('map-code-error')).toBeNull();
    for (const field of ['category', 'unit', 'cost', 'price']) {
      expect(document.getElementById(`map-${field}-error`)?.textContent).toBe(at('errors.field.required'));
    }
    expect(document.activeElement?.id).toBe('map-category');
  });

  test('the category box', async () => {
    show(
      <PriceBookClient
        view={FIRST_VIEW}
        book={{ rows: [ITEM], sectionCounts: { 's-1': 1 }, matched: 1, page: 1, pageCount: 1, hasAnyItem: true }}
        market={{ bulletin: null, refs: {} }}
        sections={SECTIONS}
        canManage
      />,
    );
    fireEvent.change(document.getElementById('pb-new-section')!, { target: { value: 'Joinery' } });
    await expectFieldErrorsRenderUnderFields({
      fields: ['name'],
      controlIdOf: () => 'pb-new-section',
      answerWith: (result: ActionResult) => sectionActions.addSection.mockResolvedValue(result),
      submit: press(at('priceBook.addSection')),
      locale,
      typed: { 'pb-new-section': 'Joinery' },
    });
  });
});
