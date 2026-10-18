// The builder's "From price book" picker with a seeded book (450+ items): it
// asks the server for its items only when opened, reads by name, groups by
// section, finds by name or code, and stays short. The server's SQL (search,
// order, limit) is tested against Postgres in
// tests/actions/price-book-search.dbtest.ts; here the server is a stand-in that
// answers the same way.
import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { searchForm } from '@/lib/price-book/name-order';
import { PICKER_LIMIT } from '@/lib/price-book/picker-types';
import { messageAt, renderWithIntl } from '@/test/render-with-intl';
import type { CostItemOption } from './builder-model';
import { PriceBookPicker } from './price-book-picker';
import { pickerList } from './price-book-picker-model';
import type { SectionOption } from './section-combobox';
import { PICKER_PAUSE_MS } from './use-price-book-search';

const server = vi.hoisted(() => ({ searchPriceBookPicker: vi.fn() }));
vi.mock('@/lib/price-book/picker-actions', () => server);

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
const BOOK = [OWN, ...SEEDED, WIRE, option('pp', { nameAr: 'مواسير بولى بروبلين', nameEn: 'PP pipe' })];

/** The server's answer as picker-query.ts gives it: every word, in the book's order, at most PICKER_LIMIT. */
function answerFor(query: string) {
  const words = searchForm(query).split(' ').filter(Boolean);
  const found = BOOK.filter((item) => words.every((word) => searchForm(`${item.code} ${item.nameEn} ${item.nameAr}`).includes(word)));
  return { ok: true, data: { items: found.slice(0, PICKER_LIMIT), matched: found.length } };
}

beforeEach(() => {
  server.searchPriceBookPicker.mockReset();
  server.searchPriceBookPicker.mockImplementation(async (query: string) => answerFor(query));
});

describe('pickerList', () => {
  it('keeps the server order under section headings, items whose section the builder does not know last', () => {
    const list = pickerList([OWN, option('a', { nameEn: 'Alpha' }), option('b', { nameEn: 'Beta' }), option('lost', { sectionId: null })], SECTIONS, 'en', 4);
    expect(list.groups.map((group) => group.title)).toEqual(['Civil', 'Glass', null]);
    expect(list.groups[1].entries.map((entry) => entry.name)).toEqual(['Alpha', 'Beta']);
  });

  it('says how many matches the answer left out', () => {
    const list = pickerList(SEEDED.slice(0, PICKER_LIMIT), SECTIONS, 'en', 452);
    expect(list.matched).toBe(452);
    expect(list.hidden).toBe(452 - PICKER_LIMIT);
  });
});

describe('PriceBookPicker', () => {
  async function open(locale: 'ar-EG' | 'en' = 'ar-EG') {
    const onPick = vi.fn();
    renderWithIntl(<PriceBookPicker sections={SECTIONS} onPick={onPick} />, { locale });
    expect(server.searchPriceBookPicker).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: messageAt(locale, 'proposals.builder.fromPriceBook') }));
    expect(screen.getByRole('status').textContent).toBe(messageAt(locale, 'proposals.builder.priceBookLoading'));
    await screen.findAllByRole('option');
    return onPick;
  }

  async function type(text: string) {
    fireEvent.change(screen.getByRole('combobox'), { target: { value: text } });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, PICKER_PAUSE_MS + 50));
    });
  }

  it('asks the server only when opened, then shows names first with the code beside them, under section headings', async () => {
    await open('ar-EG');
    expect(server.searchPriceBookPicker).toHaveBeenCalledWith('', 'ar-EG');
    expect(screen.getAllByRole('option')[0].textContent).toBe('دولابSEED-A-001');
    expect(screen.getByText('أعمال مدنية')).toBeTruthy();
    expect(screen.getAllByRole('option')).toHaveLength(PICKER_LIMIT);
  });

  it('narrows as the studio types a name, and Enter adds the item', async () => {
    const onPick = await open('en');
    await type('wardr');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith(OWN);
  });

  it('Enter while the answer for what was just typed is on its way picks nothing', async () => {
    const onPick = await open('en');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'wardr' } });
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect(onPick).not.toHaveBeenCalled();
    await type('wardr');
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith(OWN);
  });

  it('says so when nothing matches', async () => {
    await open('en');
    await type('zzzz');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText(messageAt('en', 'proposals.builder.priceBookNothing'))).toBeTruthy();
  });

  it('finds an item typed with Arabic-Indic digits and the words in another order (P1)', async () => {
    await open('ar-EG');
    for (const typed of ['نحاس معزول ٢ مم', 'نحاس ۲', 'معزول أسلاك']) {
      await type(typed);
      expect(screen.getAllByRole('option').map((row) => row.textContent)).toEqual([`${WIRE.nameAr}${WIRE.code}`]);
    }
  });

  it('counts the rows it does not show in Latin digits, in Arabic too (Digits)', async () => {
    await open('ar-EG');
    const hidden = String(BOOK.length - PICKER_LIMIT);
    const more = screen.getByText((text, element) => element?.tagName === 'P' && text.includes(hidden));
    expect(more.textContent).not.toMatch(/[٠-٩۰-۹]/);
  });

  it('reuses an answer for a search it already asked, folded («بولى» is «بولي»)', async () => {
    await open('ar-EG');
    await type('بولى');
    await type('');
    await type('بولي');
    expect(server.searchPriceBookPicker.mock.calls.map(([query]) => query)).toEqual(['', 'بولي']);
  });

  it('says why when the server cannot answer, with the reference', async () => {
    server.searchPriceBookPicker.mockResolvedValue({ ok: false, error: 'generic', reference: 'PB-7Q2' });
    renderWithIntl(<PriceBookPicker sections={SECTIONS} onPick={vi.fn()} />, { locale: 'en' });
    fireEvent.click(screen.getByRole('button', { name: messageAt('en', 'proposals.builder.fromPriceBook') }));
    expect((await screen.findByRole('alert')).textContent).toContain('PB-7Q2');
  });
});
