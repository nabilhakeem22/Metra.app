import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ContractLineOption, ContractLineView, ContractPageDetail, ContractSectionSummary } from '@/lib/contracts/queries';
import { pickOption } from '@/test/pick-option';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { ContractDetailClient } from './contract-detail-client';
import { contractPagePayload } from './page-payload';
import { ContractSectionList } from './contract-section-list';
import { useKeptSectionLines } from './use-kept-section-lines';
import { useKeptSections } from './use-kept-sections';
import { useVariationCreate } from './use-variation-create';
import { VariationCreateForm } from './variation-create-form';
import { variationLineControlId } from './variation-line-row';

// PR B1: the contract page shows a section's lines a page at a time, kept
// across the tabs, and the variation form finds a contract line by searching,
// paged on so every line can be picked. Neither holds the whole contract.
// A3 reliability R1: the sections themselves come 50 at a time, through one
// list, and only on the tab that shows them.

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('@/i18n/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/routing')>()),
  useRouter: () => router,
}));
const lineReads = vi.hoisted(() => ({ loadSectionLines: vi.fn(), loadContractSections: vi.fn(), searchBaselineLines: vi.fn() }));
vi.mock('@/lib/contracts/lines-actions', () => lineReads);
vi.mock('@/lib/contracts/actions', () => ({ issueContract: vi.fn(), terminateContract: vi.fn(), saveContractDraft: vi.fn() }));
vi.mock('@/lib/variations/actions', () => ({ createVariationDraft: vi.fn(), saveVariationDraft: vi.fn() }));
// The Payments tab's server actions: never called on these tabs, mocked so the page loads.
vi.mock('@/lib/execution/billing/actions', () => ({ loadContractBilling: vi.fn(), loadContractPayments: vi.fn() }));
vi.mock('@/lib/execution/requests/actions', () => ({ issueMilestoneRequest: vi.fn(), issueVariationRequest: vi.fn(), voidPaymentRequest: vi.fn() }));
vi.mock('@/lib/execution/payments/actions', () => ({ recordContractPayment: vi.fn() }));

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
const section = (lineCount: number, openingLines: ContractLineView[], id = 's-1'): ContractSectionSummary => ({
  id,
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
  const lines = useKeptSectionLines();
  const sections = useKeptSections({ sections: [summary], hasMore: false });
  return <ContractSectionList contractId="k-1" sections={sections} lines={lines} m={(v: string) => v} />;
}
function VariationFormHarness() {
  const create = useVariationCreate('k-1', false);
  return <VariationCreateForm create={create} contractId="k-1" />;
}

beforeEach(() => {
  lineReads.loadSectionLines.mockReset();
  lineReads.loadContractSections.mockReset();
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
    const detail = { id: 'k-1', status: 'issued', originalValue: '1', revisedValue: '1', signed: null };
    renderWithIntl(
      <ContractDetailClient
        {...contractPagePayload(detail as unknown as ContractPageDetail, { seeContract: true })}
        openingSections={{ sections: [section(2, [])], hasMore: false }}
        variations={[]}
        schedule={null}
        billingMay={{ issue: false, record: false }}
        tabs={['overview', 'variations']}
        openingTab="overview"
        canSignOffline={false}
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

  test('a signed contract says the Cairo day and the way it was signed (F4)', () => {
    for (const via of ['paper', 'online'] as const) {
      const detail = { id: 'k-1', status: 'signed', originalValue: '1', revisedValue: '1', signed: { on: '2026-10-15', via } };
      const { unmount } = renderWithIntl(
        <ContractDetailClient
          {...contractPagePayload(detail as unknown as ContractPageDetail, { seeContract: true })}
          openingSections={{ sections: [], hasMore: false }}
          variations={[]}
          schedule={null}
          billingMay={{ issue: false, record: false }}
          tabs={['overview', 'variations']}
          openingTab="overview"
          canSignOffline={false}
          canManage={false}
          canIssue={false}
          canDraftVariation={false}
          canPriceVariation={false}
        />,
        { locale },
      );
      const said = { en: { paper: 'Signed on 15/10/2026 (on paper)', online: 'Signed on 15/10/2026 (online)' }, 'ar-EG': { paper: 'اتوقّع يوم 15/10/2026 (ورقيًا)', online: 'اتوقّع يوم 15/10/2026 (إلكترونيًا)' } };
      expect(screen.getByText(said[locale][via])).toBeTruthy();
      unmount();
    }
  });

  test('"show more sections" asks after the last section shown and adds the next page below (R1)', async () => {
    const more = { sections: [section(1, [], 's-51')], hasMore: false };
    lineReads.loadContractSections.mockResolvedValue({ ok: true, data: more });
    function ListHarness() {
      const lines = useKeptSectionLines();
      const sections = useKeptSections({ sections: [section(0, [], 's-1'), section(0, [], 's-50')], hasMore: true });
      return <ContractSectionList contractId="k-1" sections={sections} lines={lines} m={(v: string) => v} />;
    }
    renderWithIntl(<ListHarness />, { locale });
    expect(screen.getAllByRole('heading')).toHaveLength(2);
    await press(messageAt(locale, 'contracts.lines.moreSections'));
    expect(lineReads.loadContractSections).toHaveBeenCalledWith({ contractId: 'k-1', afterSectionId: 's-50' });
    expect(screen.getAllByRole('heading')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: messageAt(locale, 'contracts.lines.moreSections') })).toBeNull();
  });

  test('a failed "show more sections" says it could not load sections, keeps the list and the button (N4)', async () => {
    lineReads.loadContractSections.mockResolvedValue({ ok: false, error: 'generic' });
    function ListHarness() {
      const lines = useKeptSectionLines();
      const sections = useKeptSections({ sections: [section(0, [], 's-1')], hasMore: true });
      return <ContractSectionList contractId="k-1" sections={sections} lines={lines} m={(v: string) => v} />;
    }
    renderWithIntl(<ListHarness />, { locale });
    await press(messageAt(locale, 'contracts.lines.moreSections'));
    expect(screen.getByRole('alert').textContent).toBe(messageAt(locale, 'contracts.lines.loadSectionsFailed'));
    expect(messageAt(locale, 'contracts.lines.loadSectionsFailed')).not.toBe(messageAt(locale, 'contracts.lines.loadFailed'));
    expect(screen.getAllByRole('heading')).toHaveLength(1);
    expect(screen.getByRole('button', { name: messageAt(locale, 'contracts.lines.moreSections') })).toBeTruthy();
  });

  test('a sections page that lands twice adds each section once (R1)', async () => {
    let kept: ReturnType<typeof useKeptSections> | null = null;
    function Probe() {
      kept = useKeptSections(null);
      return <p>{kept.page?.sections.length ?? 'none'}</p>;
    }
    renderWithIntl(<Probe />, { locale });
    const page = { sections: [section(1, [], 's-1'), section(1, [], 's-2')], hasMore: false };
    await act(async () => {
      kept!.append(page);
      kept!.append(page);
    });
    expect(screen.getByText('2')).toBeTruthy();
  });

  test('opened on another tab, the sections load once when the overview is first shown, and stay (R1)', async () => {
    lineReads.loadContractSections.mockResolvedValue({ ok: true, data: { sections: [section(2, [line(1), line(2)])], hasMore: false } });
    const detail = { id: 'k-1', status: 'issued', originalValue: '1', revisedValue: '1', signed: null };
    renderWithIntl(
      <ContractDetailClient
        {...contractPagePayload(detail as unknown as ContractPageDetail, { seeContract: true })}
        openingSections={null}
        variations={[]}
        schedule={null}
        billingMay={{ issue: false, record: false }}
        tabs={['overview', 'variations']}
        openingTab="variations"
        canSignOffline={false}
        canManage={false}
        canIssue={false}
        canDraftVariation={false}
        canPriceVariation={false}
      />,
      { locale },
    );
    expect(lineReads.loadContractSections).not.toHaveBeenCalled();
    await press(messageAt(locale, 'contracts.contract'));
    expect(lineReads.loadContractSections).toHaveBeenCalledWith({ contractId: 'k-1', afterSectionId: null });
    expect(screen.getAllByRole('row')).toHaveLength(2);
    await press(messageAt(locale, 'variations.register'));
    await press(messageAt(locale, 'contracts.contract'));
    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(lineReads.loadContractSections).toHaveBeenCalledTimes(1);
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
