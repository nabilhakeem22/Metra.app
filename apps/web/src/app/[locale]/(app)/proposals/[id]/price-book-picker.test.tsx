// The builder's "From price book" picker with a seeded book (450+ items): it
// reads by name, groups by section, finds by name or code, and stays short.
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { messageAt, renderWithIntl } from '@/test/render-with-intl';
import type { CostItemOption } from './builder-model';
import { PriceBookPicker } from './price-book-picker';
import { PICKER_LIMIT, pickerList } from './price-book-picker-model';
import type { SectionOption } from './section-combobox';

const SECTIONS: SectionOption[] = [
  { id: 'glass', nameEn: 'Glass', nameAr: 'الزجاج' },
  { id: 'civil', nameEn: 'Civil', nameAr: 'أعمال مدنية' },
];

function option(id: string, overrides: Partial<CostItemOption> = {}): CostItemOption {
  return { id, code: `MKT-${id}`, sectionId: 'glass', nameEn: `Item ${id}`, nameAr: `بند ${id}`, unit: 'sqm', defaultUnitCost: '1', defaultUnitPrice: '1', ...overrides };
}

const OWN = option('own', { code: 'SEED-A-001', sectionId: 'civil', nameEn: 'Wardrobe', nameAr: 'دولاب' });
const SEEDED = Array.from({ length: 450 }, (_, index) => option(`s${String(index).padStart(3, '0')}`));
const WIRE = option('wire', { nameAr: 'أسلاك نحاس معزول 2 مم', nameEn: 'Insulated copper wire 2 mm' });
const BOOK = [...SEEDED, OWN, WIRE, option('pp', { nameAr: 'مواسير بولى بروبلين', nameEn: 'PP pipe' }), option('lost', { sectionId: 'gone', nameEn: 'Orphan', nameAr: 'يتيم' })];

describe('pickerList', () => {
  it('groups by section, sections and items ordered by name, items without a known section last', () => {
    const list = pickerList([OWN, option('b', { nameEn: 'Beta' }), option('a', { nameEn: 'Alpha' }), BOOK[BOOK.length - 1]], SECTIONS, 'en', '');
    expect(list.groups.map((group) => group.title)).toEqual(['Civil', 'Glass', null]);
    expect(list.groups[1].entries.map((entry) => entry.name)).toEqual(['Alpha', 'Beta']);
  });

  it('finds by the name in either language, Arabic spellings folded, and by the code', () => {
    expect(pickerList(BOOK, SECTIONS, 'ar-EG', 'بولي').groups.flatMap((group) => group.entries.map((entry) => entry.item.id))).toEqual(['pp']);
    expect(pickerList(BOOK, SECTIONS, 'en', 'wardrobe').matched).toBe(1);
    expect(pickerList(BOOK, SECTIONS, 'en', 'seed-a-001').matched).toBe(1);
  });

  it('lists at most PICKER_LIMIT rows and says how many more matched', () => {
    const list = pickerList(BOOK, SECTIONS, 'en', '');
    const shown = list.groups.reduce((sum, group) => sum + group.entries.length, 0);
    expect(shown).toBe(PICKER_LIMIT);
    expect(list.hidden).toBe(BOOK.length - PICKER_LIMIT);
  });
});

describe('PriceBookPicker', () => {
  function open(locale: 'ar-EG' | 'en' = 'ar-EG') {
    const onPick = vi.fn();
    renderWithIntl(<PriceBookPicker costItems={BOOK} sections={SECTIONS} onPick={onPick} />, { locale });
    fireEvent.click(screen.getByRole('button', { name: messageAt(locale, 'proposals.builder.fromPriceBook') }));
    return onPick;
  }

  it('shows names first in the page language with the code beside them, under section headings', () => {
    open('ar-EG');
    const first = screen.getAllByRole('option')[0];
    expect(first.textContent).toBe('دولابSEED-A-001');
    expect(screen.getByText('أعمال مدنية')).toBeTruthy();
    expect(screen.getAllByRole('option')).toHaveLength(PICKER_LIMIT);
  });

  it('narrows as the studio types a name, and Enter adds the item', () => {
    const onPick = open('en');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'wardr' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith(OWN);
  });

  it('says so when nothing matches', () => {
    open('en');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zzzz' } });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText(messageAt('en', 'proposals.builder.priceBookNothing'))).toBeTruthy();
  });

  it('finds an item typed with Arabic-Indic digits and the words in another order (P1)', () => {
    open('ar-EG');
    for (const typed of ['نحاس معزول ٢ مم', 'نحاس ۲', 'معزول أسلاك']) {
      fireEvent.change(screen.getByRole('combobox'), { target: { value: typed } });
      expect(screen.getAllByRole('option').map((row) => row.textContent)).toEqual([`${WIRE.nameAr}${WIRE.code}`]);
    }
  });

  it('counts the rows it does not show in Latin digits, in Arabic too (Digits)', () => {
    open('ar-EG');
    const hidden = String(BOOK.length - PICKER_LIMIT);
    const more = screen.getByText((text, element) => element?.tagName === 'P' && text.includes(hidden));
    expect(more.textContent).not.toMatch(/[٠-٩۰-۹]/);
  });
});
