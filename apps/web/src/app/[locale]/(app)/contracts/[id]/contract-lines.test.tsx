import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ContractLineOption, ContractLineView, ContractPageDetail, ContractSectionSummary } from '@/lib/contracts/queries';
import { pickOption } from '@/test/pick-option';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { ContractDetailClient } from './contract-detail-client';
import { ContractSectionCard } from './contract-section-card';
import { useKeptSectionLines } from './use-kept-section-lines';
import { useVariationCreate } from './use-variation-create';
import { VariationCreateForm } from './variation-create-form';
import { variationLineControlId } from './variation-line-row';

// PR B1: the contract page shows a section's lines a page at a time, kept
// across the tabs, and the variation form finds a contract line by searching,
// paged on so every line can be picked. Neither holds the whole contract.

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('@/i18n/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/routing')>()),
  useRouter: () => router,
}));
const lineReads = vi.hoisted(() => ({ loadSectionLines: vi.fn(), searchBaselineLines: vi.fn() }));
vi.mock('@/lib/contracts/lines-actions', () => lineReads);
vi.mock('@/lib/contracts/actions', () => ({ issueContract: vi.fn(), terminateContract: vi.fn(), saveContractDraft: vi.fn() }));
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
const option = (n: number): ContractLineOption => ({
  id: `l-${n}`,
  descriptionAr: `بند ${n}`,
  descriptionEn: `Line ${n}`,
  sectionTitleAr: 'مدني',
  sectionTitleEn: 'Civil',
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
const answered = (lines: ContractLineOption[], hasMore: boolean) => ({ ok: true, data: { lines, hasMore } });

function SectionHarness({ summary }: { summary: ContractSectionSummary }) {
  const kept = useKeptSectionLines();
  return <ContractSectionCard contractId="k-1" section={summary} kept={kept} m={(v) => v} />;
}
function VariationFormHarness() {
  const create = useVariationCreate('k-1');
  return <VariationCreateForm create={create} contractId="k-1" />;
}

beforeEach(() => {
  lineReads.loadSectionLines.mockReset();
  lineReads.searchBaselineLines.mockReset();
  router.refresh.mockReset();
});

describe.each<TestLocale>(['en', 'ar-EG'])('contract lines, a page at a time (%s)', (locale) => {
  const at = (key: string, count?: number) => messageAt(locale, key).replace('{count}', String(count));
  const showCard = (summary: ContractSectionSummary) => renderWithIntl(<SectionHarness summary={summary} />, { locale });
  const press = (name: string) => act(async () => fireEvent.click(screen.getByRole('button', { name })));

  test('a section that opened whole offers nothing more', () => {
    showCard(section(2, [line(1), line(2)]));
    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(screen.queryByRole('button')).toBeNull();
  });

  test('"show more" asks for the lines after the last one shown, and goes when none remain', async () => {
    lineReads.loadSectionLines.mockResolvedValue({ ok: true, data: { lines: [line(3), line(4)], hasMore: false } });
    showCard(section(4, [line(1), line(2)]));
    await press(at('contracts.lines.showMore', 2));
    expect(lineReads.loadSectionLines).toHaveBeenCalledWith({ contractId: 'k-1', sectionId: 's-1', afterLineId: 'l-2' });
    expect(screen.getAllByRole('row')).toHaveLength(4);
    expect(screen.queryByRole('button')).toBeNull();
  });

  test('a second press while one ask is in flight asks nothing more (F7)', async () => {
    lineReads.loadSectionLines.mockResolvedValue({ ok: true, data: { lines: [line(1)], hasMore: true } });
    showCard(section(120, []));
    const button = screen.getByRole('button', { name: at('contracts.lines.show', 120) });
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(lineReads.loadSectionLines).toHaveBeenCalledTimes(1);
    expect(lineReads.loadSectionLines).toHaveBeenCalledWith({ contractId: 'k-1', sectionId: 's-1', afterLineId: null });
    expect(screen.getByRole('button', { name: at('contracts.lines.showMore', 119) })).toBeTruthy();
  });

  test('a failed load says it could not load, and the lines, count and button stay (F8)', async () => {
    lineReads.loadSectionLines.mockResolvedValue({ ok: false, error: 'generic' });
    showCard(section(4, [line(1), line(2)]));
    await press(at('contracts.lines.showMore', 2));
    expect(screen.getByRole('alert').textContent).toBe(messageAt(locale, 'contracts.lines.loadFailed'));
    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(screen.getByRole('button', { name: at('contracts.lines.showMore', 2) })).toBeTruthy();
  });

  test('lines no longer this workspace\'s are said, never shown as an empty section, with a reload (F3)', async () => {
    lineReads.loadSectionLines.mockResolvedValue({ ok: false, error: 'record_not_found' });
    showCard(section(100, []));
    await press(at('contracts.lines.show', 100));
    expect(screen.getByRole('alert').textContent).toBe(messageAt(locale, 'contracts.lines.gone'));
    expect(screen.getByRole('button', { name: at('contracts.lines.show', 100) })).toBeTruthy();
    await press(messageAt(locale, 'contracts.lines.reload'));
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  test('loaded lines survive a trip to the variation register and back (F6)', async () => {
    lineReads.loadSectionLines.mockResolvedValue({ ok: true, data: { lines: [line(1), line(2)], hasMore: false } });
    const detail = { id: 'k-1', status: 'issued', originalValue: '1', revisedValue: '1', sections: [section(2, [])] };
    renderWithIntl(
      <ContractDetailClient
        detail={detail as unknown as ContractPageDetail}
        variations={[]}
        canManage={false}
        canIssue={false}
        canDraftVariation={false}
        canPriceVariation={false}
      />,
      { locale },
    );
    await press(at('contracts.lines.show', 2));
    await press(messageAt(locale, 'variations.register'));
    await press(messageAt(locale, 'contracts.contract'));
    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(lineReads.loadSectionLines).toHaveBeenCalledTimes(1);
  });

  test('the picker pages on with "more results", labels lines with their section, and keeps a pick', async () => {
    lineReads.searchBaselineLines.mockResolvedValueOnce(answered([option(1)], true));
    renderWithIntl(<VariationFormHarness />, { locale });
    fireEvent.click(screen.getByRole('button', { name: messageAt(locale, 'variations.line.add') }));
    await settle();
    expect(lineReads.searchBaselineLines).toHaveBeenLastCalledWith({ contractId: 'k-1', query: '', afterLineId: null });
    expect(screen.getByText(at('variations.line.capped', 1))).toBeTruthy();
    lineReads.searchBaselineLines.mockResolvedValueOnce(answered([option(60)], false));
    await press(messageAt(locale, 'variations.line.more'));
    expect(lineReads.searchBaselineLines).toHaveBeenLastCalledWith({ contractId: 'k-1', query: '', afterLineId: 'l-1' });
    expect(screen.queryByRole('button', { name: messageAt(locale, 'variations.line.more') })).toBeNull();
    const label = locale === 'en' ? 'Line 60 (Civil)' : 'بند 60 (مدني)';
    await pickOption(variationLineControlId('vo-1', 'contractLineId'), label);

    lineReads.searchBaselineLines.mockResolvedValue(answered([option(8)], true));
    fireEvent.change(document.getElementById(`${variationLineControlId('vo-1', 'contractLineId')}-find`)!, {
      target: { value: 'door' },
    });
    await settle();
    expect(lineReads.searchBaselineLines).toHaveBeenLastCalledWith({ contractId: 'k-1', query: 'door', afterLineId: null });
    expect(screen.queryByText(at('variations.line.capped', 1))).toBeNull();
    expect(document.getElementById(variationLineControlId('vo-1', 'contractLineId'))!.textContent).toBe(label);
  });

  test('a failed search is said under the search box, as a failed load', async () => {
    lineReads.searchBaselineLines.mockResolvedValue({ ok: false, error: 'generic' });
    renderWithIntl(<VariationFormHarness />, { locale });
    fireEvent.click(screen.getByRole('button', { name: messageAt(locale, 'variations.line.add') }));
    await settle();
    const findId = `${variationLineControlId('vo-1', 'contractLineId')}-find`;
    expect(document.getElementById(`${findId}-error`)?.textContent).toBe(messageAt(locale, 'contracts.lines.loadFailed'));
  });
});
