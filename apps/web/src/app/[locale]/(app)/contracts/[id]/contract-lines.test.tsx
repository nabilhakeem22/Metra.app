import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ContractLineView, ContractSectionSummary } from '@/lib/contracts/queries';
import { pickOption } from '@/test/pick-option';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { ContractSectionCard } from './contract-section-card';
import { useVariationCreate } from './use-variation-create';
import { variationLineControlId } from './variation-line-row';
import { VariationCreateForm } from './variation-create-form';

// PR B1: the contract page shows a section's lines a page at a time, and the
// variation form finds a contract line by searching. Neither holds the whole
// contract.

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('@/i18n/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/routing')>()),
  useRouter: () => router,
}));
const lineReads = vi.hoisted(() => ({ loadSectionLines: vi.fn(), searchBaselineLines: vi.fn() }));
vi.mock('@/lib/contracts/lines-actions', () => lineReads);
vi.mock('@/lib/variations/actions', () => ({ createVariationDraft: vi.fn(), saveVariationDraft: vi.fn() }));

const line = (n: number): ContractLineView => ({
  id: `l-${n}`,
  descriptionAr: `بند ${n}`,
  descriptionEn: `Line ${n}`,
  qty: '1',
  unit: 'sqm',
  unitPrice: '100',
  lineTotal: '100',
});
const section = (lineCount: number, openingLines: ContractLineView[]): ContractSectionSummary => ({
  id: 's-1',
  titleAr: 'مدني',
  titleEn: 'Civil',
  sortOrder: 0,
  sectionSubtotal: '400',
  lineCount,
  openingLines,
});
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 250)));

function VariationFormHarness() {
  const create = useVariationCreate('k-1');
  return <VariationCreateForm create={create} contractId="k-1" />;
}

beforeEach(() => {
  lineReads.loadSectionLines.mockReset();
  lineReads.searchBaselineLines.mockReset();
});

describe.each<TestLocale>(['en', 'ar-EG'])('contract lines, a page at a time (%s)', (locale) => {
  const at = (key: string, count?: number) => messageAt(locale, key).replace('{count}', String(count));
  const showCard = (summary: ContractSectionSummary) =>
    renderWithIntl(<ContractSectionCard contractId="k-1" section={summary} m={(v) => v} />, { locale });

  test('a section that opened whole offers nothing more', () => {
    showCard(section(2, [line(1), line(2)]));
    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(screen.queryByRole('button')).toBeNull();
  });

  test('"show more" asks for the lines after the last one shown, and goes when none remain', async () => {
    lineReads.loadSectionLines.mockResolvedValue({ ok: true, data: { lines: [line(3), line(4)], hasMore: false } });
    showCard(section(4, [line(1), line(2)]));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: at('contracts.lines.showMore', 2) })));
    expect(lineReads.loadSectionLines).toHaveBeenCalledWith({ contractId: 'k-1', sectionId: 's-1', afterLineId: 'l-2' });
    expect(screen.getAllByRole('row')).toHaveLength(4);
    expect(screen.queryByRole('button')).toBeNull();
  });

  test('a section outside the opening window starts from its first line', async () => {
    lineReads.loadSectionLines.mockResolvedValue({ ok: true, data: { lines: [line(1)], hasMore: true } });
    showCard(section(120, []));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: at('contracts.lines.show', 120) })));
    expect(lineReads.loadSectionLines).toHaveBeenCalledWith({ contractId: 'k-1', sectionId: 's-1', afterLineId: null });
    expect(screen.getByRole('button', { name: at('contracts.lines.showMore', 119) })).toBeTruthy();
  });

  test('a refused page is said under its button, and the lines shown stay', async () => {
    lineReads.loadSectionLines.mockResolvedValue({ ok: false, error: 'forbidden' });
    showCard(section(4, [line(1), line(2)]));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: at('contracts.lines.showMore', 2) })));
    expect(screen.getByRole('alert').textContent).toBe(messageAt(locale, 'errors.forbidden'));
    expect(screen.getAllByRole('row')).toHaveLength(2);
  });

  test('the variation picker offers what the search found, and keeps a pick across searches', async () => {
    lineReads.searchBaselineLines.mockResolvedValue({ ok: true, data: { lines: [line(7)], hasMore: true } });
    renderWithIntl(<VariationFormHarness />, { locale });
    fireEvent.click(screen.getByRole('button', { name: messageAt(locale, 'variations.line.add') }));
    await settle();
    expect(lineReads.searchBaselineLines).toHaveBeenLastCalledWith({ contractId: 'k-1', query: '' });
    expect(screen.getByText(at('variations.line.capped', 1))).toBeTruthy();
    const label = locale === 'en' ? 'Line 7' : 'بند 7';
    await pickOption(variationLineControlId('vo-1', 'contractLineId'), label);

    lineReads.searchBaselineLines.mockResolvedValue({ ok: true, data: { lines: [line(8)], hasMore: false } });
    fireEvent.change(document.getElementById(`${variationLineControlId('vo-1', 'contractLineId')}-find`)!, {
      target: { value: 'door' },
    });
    await settle();
    expect(lineReads.searchBaselineLines).toHaveBeenLastCalledWith({ contractId: 'k-1', query: 'door' });
    expect(document.getElementById(variationLineControlId('vo-1', 'contractLineId'))!.textContent).toBe(label);
  });

  test('a failed search is said under the search box', async () => {
    lineReads.searchBaselineLines.mockResolvedValue({ ok: false, error: 'forbidden' });
    renderWithIntl(<VariationFormHarness />, { locale });
    fireEvent.click(screen.getByRole('button', { name: messageAt(locale, 'variations.line.add') }));
    await settle();
    const findId = `${variationLineControlId('vo-1', 'contractLineId')}-find`;
    expect(document.getElementById(`${findId}-error`)?.textContent).toBe(messageAt(locale, 'errors.forbidden'));
  });
});
