import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { messageAt, renderWithIntl } from '@/test/render-with-intl';
import { ImportWizard } from './import-wizard';

// The import preview on a PAGED price book: the page holds one page of items,
// not every code, so Preview asks the server which of the sheet's codes the
// book already has, and marks those rows before anything is imported.

const priceBook = vi.hoisted(() => ({
  parseCostImport: vi.fn(),
  findExistingCostItemCodes: vi.fn(),
  importCostItems: vi.fn(),
}));
vi.mock('@/lib/price-book/actions', () => priceBook);
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }));

const SECTIONS = [{ id: 's-1', key: 'civil', nameEn: 'Civil', nameAr: 'مدني' }];
const SHEET = {
  header: ['Code', 'Name', 'Category', 'Unit', 'Cost', 'Price'],
  data: [
    ['OLD-1', 'Board', 'civil', 'sqm', '1', '2'],
    ['NEW-1', 'Paint', 'civil', 'sqm', '3', '4'],
    ['', 'No code', 'civil', 'sqm', '1', '1'],
  ],
};

beforeEach(() => {
  for (const action of Object.values(priceBook)) action.mockReset();
  priceBook.parseCostImport.mockResolvedValue({ ok: true, data: SHEET });
});

async function preview() {
  renderWithIntl(<ImportWizard open onOpenChange={() => {}} sections={SECTIONS} />, { locale: 'en' });
  await act(async () => {
    fireEvent.change(document.getElementById('import-file')!, { target: { files: [new File(['x'], 'items.csv', { type: 'text/csv' })] } });
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: messageAt('en', 'priceBook.import.preview') }));
  });
}

describe('the import preview on a paged book', () => {
  test('asks which of the sheet codes exist, and marks those rows', async () => {
    priceBook.findExistingCostItemCodes.mockResolvedValue({ ok: true, data: ['OLD-1'] });
    await preview();
    expect(priceBook.findExistingCostItemCodes).toHaveBeenCalledWith(['OLD-1', 'NEW-1']);
    const rows = screen.getAllByRole('row').slice(1).map((row) => row.textContent);
    expect(rows[0]).toContain(messageAt('en', 'priceBook.import.errors.code_exists'));
    expect(rows[1]).toContain(messageAt('en', 'priceBook.import.willImport'));
  });

  test('a failed lookup is said above the buttons, and the preview does not open', async () => {
    priceBook.findExistingCostItemCodes.mockResolvedValue({ ok: false, error: 'generic', reference: 'IMP-42' });
    await preview();
    expect(screen.getByRole('alert').textContent).toContain('IMP-42');
    expect(screen.queryAllByRole('row')).toHaveLength(0);
  });
});
