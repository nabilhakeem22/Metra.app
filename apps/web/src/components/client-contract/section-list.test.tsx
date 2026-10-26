import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { PublicContractLine, PublicContractSection } from '@/lib/contracts/public-types';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { ContractSectionList } from './section-list';

// PR A3.6, AC11 on the page, now in the list /c and the client home share
// (H6.1): a section opens on its snapshot lines, "show more" asks the page's
// loader for the next 100 from where the list stands; a section that answers
// nothing, or a shared failure, is said in فصحى and the lines shown stay. A3
// reliability R1: the list opens on 50 sections and "show more sections" adds
// 50 more, collapsed.

const line = (n: number): PublicContractLine => ({
  id: `l-${String(n)}`,
  item_code: `A-${String(n)}`,
  description_ar: `بند ${String(n)}`,
  description_en: `Line ${String(n)}`,
  qty: '1.0000',
  unit: 'sqm',
  unit_price: '100.0000',
  discount_pct: '0.0000',
  line_total: '100.0000',
  provisional: n % 5 === 0,
  sort_order: n,
});
const lines = (from: number, count: number) => Array.from({ length: count }, (_, index) => line(from + index));

const SECTION: PublicContractSection = {
  id: 's-1',
  title_ar: 'القسم',
  title_en: 'Section',
  section_subtotal: '17000.0000',
  sort_order: 0,
  line_count: 170,
  lines: lines(1, 50),
};

const collapsed = (n: number): PublicContractSection => ({ ...SECTION, id: `s-${String(n)}`, title_en: `Section ${String(n)}`, lines: [], line_count: 3 });

const loaders = vi.hoisted(() => ({ sections: vi.fn(), lines: vi.fn() }));

function renderList(sections: PublicContractSection[], sectionCount: number, locale: TestLocale) {
  return renderWithIntl(
    <ContractSectionList sections={sections} sectionCount={sectionCount} loadSections={loaders.sections} loadSectionLines={loaders.lines} />,
    { locale },
  );
}

beforeEach(() => {
  loaders.sections.mockReset();
  loaders.lines.mockReset();
});

describe.each<TestLocale>(['en', 'ar-EG'])('a client contract section (%s)', (locale) => {
  const at = (key: string, count?: number) => messageAt(locale, key).replace('{count}', String(count));
  const showMore = async (left: number) => {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: at('portal.contract.lines.showMore', left) }));
    });
  };

  test('opens on its 50 lines, then loads 100, then the last 20, from where it stands', async () => {
    renderList([SECTION], 1, locale);
    expect(screen.getAllByRole('row')).toHaveLength(50);
    loaders.lines.mockResolvedValueOnce({ ok: true, page: { section_id: 's-1', offset: 50, line_count: 170, lines: lines(51, 100) } });
    await showMore(120);
    expect(loaders.lines).toHaveBeenLastCalledWith('s-1', 50);
    expect(screen.getAllByRole('row')).toHaveLength(150);
    loaders.lines.mockResolvedValueOnce({ ok: true, page: { section_id: 's-1', offset: 150, line_count: 170, lines: lines(151, 20) } });
    await showMore(20);
    expect(loaders.lines).toHaveBeenLastCalledWith('s-1', 150);
    expect(screen.getAllByRole('row')).toHaveLength(170);
    expect(screen.queryByRole('button')).toBeNull();
  });

  test('a section past the opening window opens collapsed and shows its lines from the first', async () => {
    renderList([{ ...SECTION, lines: [], line_count: 30 }], 1, locale);
    expect(screen.queryAllByRole('row')).toHaveLength(0);
    loaders.lines.mockResolvedValueOnce({ ok: true, page: { section_id: 's-1', offset: 0, line_count: 30, lines: lines(1, 30) } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: at('portal.contract.lines.show', 30) }));
    });
    expect(loaders.lines).toHaveBeenLastCalledWith('s-1', 0);
    expect(screen.getAllByRole('row')).toHaveLength(30);
  });

  test('says too many requests, or that the lines are gone, and keeps the lines it has', async () => {
    renderList([SECTION], 1, locale);
    loaders.lines.mockResolvedValueOnce({ ok: false, error: 'too_many' });
    await showMore(120);
    expect(screen.getByRole('alert').textContent).toBe(messageAt(locale, 'portal.errors.too_many'));
    loaders.lines.mockResolvedValueOnce({ ok: false, error: 'gone' });
    await showMore(120);
    expect(screen.getByRole('alert').textContent).toBe(messageAt(locale, 'portal.contract.lines.gone'));
    expect(screen.getAllByRole('row')).toHaveLength(50);
  });

  test('a failed "show more sections" says it could not load sections, keeps the list and the button (N4)', async () => {
    renderList(Array.from({ length: 50 }, (_, n) => collapsed(n)), 60, locale);
    loaders.sections.mockRejectedValueOnce(new Error('network'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: at('portal.contract.lines.moreSections', 10) }));
    });
    expect(screen.getByRole('alert').textContent).toBe(messageAt(locale, 'portal.contract.lines.loadSectionsFailed'));
    expect(messageAt(locale, 'portal.contract.lines.loadSectionsFailed')).not.toBe(messageAt(locale, 'portal.contract.lines.loadFailed'));
    expect(screen.getAllByRole('heading')).toHaveLength(50);
    expect(screen.getByRole('button', { name: at('portal.contract.lines.moreSections', 10) })).toBeTruthy();
  });

  test('a "show more sections" that answers gone says the sections are gone, not lines, and keeps the list (H6-read F5)', async () => {
    renderList(Array.from({ length: 50 }, (_, n) => collapsed(n)), 60, locale);
    loaders.sections.mockResolvedValueOnce({ ok: false, error: 'gone' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: at('portal.contract.lines.moreSections', 10) }));
    });
    expect(screen.getByRole('alert').textContent).toBe(messageAt(locale, 'portal.contract.lines.sectionsGone'));
    expect(messageAt(locale, 'portal.contract.lines.sectionsGone')).not.toBe(messageAt(locale, 'portal.contract.lines.gone'));
    expect(screen.getAllByRole('heading')).toHaveLength(50);
  });

  test('"show more sections" asks from the sections shown, adds 50 collapsed, and goes when none remain (R1)', async () => {
    renderList(Array.from({ length: 50 }, (_, n) => collapsed(n)), 60, locale);
    expect(screen.getAllByRole('heading')).toHaveLength(50);
    loaders.sections.mockResolvedValueOnce({ ok: true, page: { offset: 50, section_count: 60, sections: Array.from({ length: 10 }, (_, n) => collapsed(50 + n)) } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: at('portal.contract.lines.moreSections', 10) }));
    });
    expect(loaders.sections).toHaveBeenLastCalledWith(50);
    expect(screen.getAllByRole('heading')).toHaveLength(60);
    expect(screen.queryByRole('button', { name: at('portal.contract.lines.moreSections', 0) })).toBeNull();
    loaders.lines.mockResolvedValueOnce({ ok: true, page: { section_id: 's-55', offset: 0, line_count: 3, lines: lines(1, 3) } });
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: at('portal.contract.lines.show', 3) })[55]);
    });
    expect(loaders.lines).toHaveBeenLastCalledWith('s-55', 0);
    expect(screen.getAllByRole('row')).toHaveLength(3);
  });
});

describe('a long unbroken section title (H6-read F2)', () => {
  test('breaks rather than push its subtotal off the card', () => {
    renderList([{ ...SECTION, title_en: 'X'.repeat(200) }], 1, 'en');
    expect(screen.getByRole('heading').className.split(' ')).toContain('[overflow-wrap:anywhere]');
  });
});
