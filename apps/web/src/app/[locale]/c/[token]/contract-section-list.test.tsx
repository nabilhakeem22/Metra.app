import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { PublicContractLine, PublicContractSection } from '@/lib/contracts/public-types';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';

// PR A3.6, AC11 on the page: a section opens on its snapshot lines, "show more"
// asks for the next 100 from where the page stands, through the link's read
// budget; past it, or for a section that answers nothing, the client is told
// in فصحى, and the action never throws to the page. A3 reliability R1: the
// page opens on 50 sections and "show more sections" adds 50 more, collapsed,
// all through one list.

vi.mock('server-only', () => ({}));
const reads = vi.hoisted(() => ({ allowed: vi.fn(async () => true), page: vi.fn(), sections: vi.fn() }));
vi.mock('@/lib/share/portal-rate-limit', () => ({ portalReadAllowed: reads.allowed }));
vi.mock('@/lib/contracts/public', () => ({
  getContractSectionLinesByToken: reads.page,
  getContractSectionsByToken: reads.sections,
  acknowledgeContractByToken: vi.fn(),
  contractPayloadHash: vi.fn(),
  getContractByToken: vi.fn(),
}));
// The browser losing the connection mid-call rejects the action itself, before
// the server can answer; the gate stands in for that.
const network = vi.hoisted(() => ({ down: false }));
vi.mock('./actions', async (importOriginal) => {
  const real = await importOriginal<typeof import('./actions')>();
  return {
    ...real,
    loadContractSections: (...args: Parameters<typeof real.loadContractSections>) =>
      network.down ? Promise.reject(new Error('network')) : real.loadContractSections(...args),
  };
});
vi.mock('@/lib/share/request-provenance', () => ({ requestProvenance: async () => ({ ip: null, userAgent: null }) }));

const { loadContractSectionLines, loadContractSections } = await import('./actions');
const { ContractSectionList } = await import('./contract-section-list');

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

beforeEach(() => {
  reads.allowed.mockReset().mockResolvedValue(true);
  reads.page.mockReset();
  reads.sections.mockReset();
  network.down = false;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('loadContractSectionLines', () => {
  test('past the read budget: too_many, and the page is never read', async () => {
    reads.allowed.mockResolvedValue(false);
    expect(await loadContractSectionLines('t', 's-1', 50)).toEqual({ ok: false, error: 'too_many' });
    expect(reads.page).not.toHaveBeenCalled();
  });

  test('a section that answers nothing is gone; a failure underneath is generic with a reference', async () => {
    reads.page.mockResolvedValue(null);
    expect(await loadContractSectionLines('t', 's-x', 0)).toEqual({ ok: false, error: 'gone' });
    reads.page.mockRejectedValue(new Error('boom'));
    expect(await loadContractSectionLines('t', 's-1', 0)).toMatchObject({ ok: false, error: 'generic', reference: expect.any(String) });
  });
});

describe('loadContractSections', () => {
  test('past the read budget: too_many, unread; nothing to show: gone', async () => {
    reads.allowed.mockResolvedValueOnce(false);
    expect(await loadContractSections('t', 50)).toEqual({ ok: false, error: 'too_many' });
    expect(reads.sections).not.toHaveBeenCalled();
    reads.sections.mockResolvedValue(null);
    expect(await loadContractSections('t', 50)).toEqual({ ok: false, error: 'gone' });
  });
});

describe.each<TestLocale>(['en', 'ar-EG'])('a contract section on /c (%s)', (locale) => {
  const at = (key: string, count?: number) => messageAt(locale, key).replace('{count}', String(count));
  const showMore = async (left: number) => {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: at('contracts.ack.lines.showMore', left) }));
    });
  };

  test('opens on its 50 lines, then loads 100, then the last 20, from where it stands', async () => {
    renderWithIntl(<ContractSectionList token="t" sections={[SECTION]} sectionCount={1} />, { locale });
    expect(screen.getAllByRole('row')).toHaveLength(50);
    reads.page.mockResolvedValueOnce({ section_id: 's-1', offset: 50, line_count: 170, lines: lines(51, 100) });
    await showMore(120);
    expect(reads.page).toHaveBeenLastCalledWith('t', 's-1', 50);
    expect(screen.getAllByRole('row')).toHaveLength(150);
    reads.page.mockResolvedValueOnce({ section_id: 's-1', offset: 150, line_count: 170, lines: lines(151, 20) });
    await showMore(20);
    expect(reads.page).toHaveBeenLastCalledWith('t', 's-1', 150);
    expect(screen.getAllByRole('row')).toHaveLength(170);
    expect(screen.queryByRole('button')).toBeNull();
  });

  test('a section past the opening window opens collapsed and shows its lines from the first', async () => {
    renderWithIntl(<ContractSectionList token="t" sections={[{ ...SECTION, lines: [], line_count: 30 }]} sectionCount={1} />, { locale });
    expect(screen.queryAllByRole('row')).toHaveLength(0);
    reads.page.mockResolvedValueOnce({ section_id: 's-1', offset: 0, line_count: 30, lines: lines(1, 30) });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: at('contracts.ack.lines.show', 30) }));
    });
    expect(reads.page).toHaveBeenLastCalledWith('t', 's-1', 0);
    expect(screen.getAllByRole('row')).toHaveLength(30);
  });

  test('says too many requests, or that the lines are gone, and keeps the lines it has', async () => {
    renderWithIntl(<ContractSectionList token="t" sections={[SECTION]} sectionCount={1} />, { locale });
    reads.allowed.mockResolvedValueOnce(false);
    await showMore(120);
    expect(screen.getByRole('alert').textContent).toBe(messageAt(locale, 'portal.errors.too_many'));
    reads.page.mockResolvedValueOnce(null);
    await showMore(120);
    expect(screen.getByRole('alert').textContent).toBe(messageAt(locale, 'contracts.ack.lines.gone'));
    expect(screen.getAllByRole('row')).toHaveLength(50);
  });

  test('a failed "show more sections" says it could not load sections, keeps the list and the button (N4)', async () => {
    const opening = Array.from({ length: 50 }, (_, n) => collapsed(n));
    renderWithIntl(<ContractSectionList token="t" sections={opening} sectionCount={60} />, { locale });
    network.down = true;
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: at('contracts.ack.lines.moreSections', 10) }));
    });
    expect(screen.getByRole('alert').textContent).toBe(messageAt(locale, 'contracts.ack.lines.loadSectionsFailed'));
    expect(messageAt(locale, 'contracts.ack.lines.loadSectionsFailed')).not.toBe(messageAt(locale, 'contracts.ack.lines.loadFailed'));
    expect(screen.getAllByRole('heading')).toHaveLength(50);
    expect(screen.getByRole('button', { name: at('contracts.ack.lines.moreSections', 10) })).toBeTruthy();
  });

  test('"show more sections" asks from the sections shown, adds 50 collapsed, and goes when none remain (R1)', async () => {
    const opening = Array.from({ length: 50 }, (_, n) => collapsed(n));
    renderWithIntl(<ContractSectionList token="t" sections={opening} sectionCount={60} />, { locale });
    expect(screen.getAllByRole('heading')).toHaveLength(50);
    reads.sections.mockResolvedValueOnce({ offset: 50, section_count: 60, sections: Array.from({ length: 10 }, (_, n) => collapsed(50 + n)) });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: at('contracts.ack.lines.moreSections', 10) }));
    });
    expect(reads.sections).toHaveBeenLastCalledWith('t', 50);
    expect(screen.getAllByRole('heading')).toHaveLength(60);
    expect(screen.queryByRole('button', { name: at('contracts.ack.lines.moreSections', 0) })).toBeNull();
    reads.page.mockResolvedValueOnce({ section_id: 's-55', offset: 0, line_count: 3, lines: lines(1, 3) });
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: at('contracts.ack.lines.show', 3) })[55]);
    });
    expect(reads.page).toHaveBeenLastCalledWith('t', 's-55', 0);
    expect(screen.getAllByRole('row')).toHaveLength(3);
  });
});
