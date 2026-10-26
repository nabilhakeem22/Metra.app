import { act, fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ContractHeaderDetail, ContractLineView, ContractPageDetail, ContractSectionSummary } from '@/lib/contracts/queries';
import { bidiIsolate } from '@/lib/format/bidi';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { ContractHeaderForm } from './contract-header-form';
import { ContractOverview } from './contract-overview';
import { PaymentsLedger } from './payments-ledger';
import { useKeptSectionLines } from './use-kept-section-lines';
import { useKeptSections } from './use-kept-sections';
import { useVariationCreate } from './use-variation-create';
import { VariationCreateForm } from './variation-create-form';
import { variationLineControlId } from './variation-line-row';

// The execution UI fix round: what the contract page says and how its figures
// read. Units are named in the page's language and quantities trimmed; every
// section's table shares one set of column widths; terminating asks first,
// naming the contract; the two terms boxes say which language each holds; a
// change-order line on no contract line says it is new work; the "Amount"
// header of the payments received sits over its amounts on either page.

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('@/i18n/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/routing')>()),
  useRouter: () => router,
}));
vi.mock('@/lib/contracts/lines-actions', () => ({
  loadSectionLines: vi.fn(),
  loadContractSections: vi.fn(),
  searchBaselineLines: vi.fn(async () => ({ ok: true, data: { lines: [], hasMore: false } })),
}));
// The contract overview's "Client page" control: never pressed here, mocked so the page loads.
vi.mock('@/lib/client-home/actions', () => ({ openClientHome: vi.fn() }));
vi.mock('@/lib/contracts/actions', () => ({
  saveContractDraft: vi.fn(),
  setContractCharges: vi.fn(),
  recordContractSignedOffline: vi.fn(),
}));
vi.mock('@/lib/variations/actions', () => ({ createVariationDraft: vi.fn(), saveVariationDraft: vi.fn() }));

const line = (n: number, qty: string, unit: string): ContractLineView => ({
  id: `l-${n}`,
  descriptionAr: `بند ${n}`,
  descriptionEn: `Line ${n}`,
  qty,
  unit,
  unitPrice: '65.0000',
  lineTotal: '14300.0000',
});
const section = (id: string, lines: ContractLineView[]): ContractSectionSummary => ({
  id,
  titleAr: 'مدني',
  titleEn: 'Civil',
  sortOrder: 0,
  sectionSubtotal: '14300.0000',
  lineCount: lines.length,
  openingLines: lines,
});

const DETAIL = {
  id: 'k-1',
  number: 1,
  createdAt: '2026-10-23T08:00:00.000Z',
  status: 'issued',
  sourceBoqId: 'b-1',
  originalValue: '1025418.0000',
  revisedValue: '1025418.0000',
  endDate: null,
  approvedExtensionDays: 0,
  signed: null,
} as unknown as ContractPageDetail;

function OverviewHarness({ onTerminate }: { onTerminate: () => void }) {
  const sections = useKeptSections({ sections: [section('s-1', [line(1, '220.0000', 'sqm')]), section('s-2', [line(2, '42.5000', 'linear_meter')])], hasMore: false });
  const lines = useKeptSectionLines();
  return (
    <ContractOverview
      detail={DETAIL}
      keptSections={sections}
      keptLines={lines}
      canManage={false}
      canIssue
      canSignOffline={false}
      pending={false}
      m={(value) => value}
      onIssue={() => {}}
      onTerminate={onTerminate}
    />
  );
}

function VariationFormHarness() {
  const create = useVariationCreate('k-1', true);
  return <VariationCreateForm create={create} contractId="k-1" />;
}

beforeEach(() => router.refresh.mockReset());

describe.each<TestLocale>(['en', 'ar-EG'])('the contract page (%s)', (locale) => {
  const at = (key: string) => messageAt(locale, key);
  const show = (ui: React.ReactElement) => {
    document.documentElement.dir = locale === 'ar-EG' ? 'rtl' : 'ltr';
    return renderWithIntl(ui, { locale });
  };

  test('a line shows its quantity trimmed and its unit named, never "220.0000 sqm"', () => {
    show(<OverviewHarness onTerminate={() => {}} />);
    const quantityOf = (row: HTMLElement) => within(row).getAllByRole('cell')[1].textContent;
    const [first, second] = screen.getAllByRole('row');
    expect(quantityOf(first)).toBe(`220 ${at('priceBook.units.sqm')}`);
    expect(quantityOf(second)).toBe(`42.5 ${at('priceBook.units.linear_meter')}`);
  });

  test('every section table has the same column widths, so the columns line up down the page', () => {
    show(<OverviewHarness onTerminate={() => {}} />);
    const tables = [...document.querySelectorAll('table')];
    expect(tables).toHaveLength(2);
    const widths = tables.map((table) => [...table.querySelectorAll('col')].map((col) => col.className).join('|'));
    expect(widths[0]).not.toBe('');
    expect(widths[1]).toBe(widths[0]);
    for (const table of tables) expect(table.className).toContain('table-fixed');
  });

  test('Terminate asks first, naming the contract; Cancel terminates nothing', async () => {
    const onTerminate = vi.fn();
    show(<OverviewHarness onTerminate={onTerminate} />);
    fireEvent.click(screen.getByRole('button', { name: at('contracts.terminate') }));
    const dialog = await screen.findByRole('alertdialog');
    const title = at('contracts.terminateConfirm.title').replace('{number}', bidiIsolate('C-2026-0001'));
    expect(within(dialog).getByText(title)).toBeTruthy();
    expect(within(dialog).getByText(at('contracts.terminateConfirm.body'))).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: at('common.cancel') }));
    await act(async () => {});
    expect(onTerminate).not.toHaveBeenCalled();
  });

  test('the destructive confirm terminates, once', async () => {
    const onTerminate = vi.fn();
    show(<OverviewHarness onTerminate={onTerminate} />);
    fireEvent.click(screen.getByRole('button', { name: at('contracts.terminate') }));
    const dialog = await screen.findByRole('alertdialog');
    const confirm = within(dialog).getByRole('button', { name: at('contracts.terminateConfirm.confirm') });
    expect(confirm.className).toContain('var(--danger)');
    fireEvent.click(confirm);
    await act(async () => {});
    expect(onTerminate).toHaveBeenCalledTimes(1);
  });

  test('the two terms boxes say which language each holds, and are typed in that direction', () => {
    const header = { ...DETAIL, status: 'draft', termsEn: null, termsAr: null, paymentTermsDays: null, defectsLiabilityDays: null, startDate: null } as unknown as ContractHeaderDetail;
    show(<ContractHeaderForm detail={header} />);
    const english = screen.getByLabelText(at('contracts.header.termsEn'));
    const arabic = screen.getByLabelText(at('contracts.header.termsAr'));
    expect(at('contracts.header.termsEn')).not.toBe(at('contracts.header.termsAr'));
    expect(english.getAttribute('dir')).toBe('ltr');
    expect(arabic.getAttribute('dir')).toBe('rtl');
  });

  test('a new change-order line offers new work on no contract line, and units by name', async () => {
    show(<VariationFormHarness />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: at('variations.line.add') }));
    });
    const baseline = document.getElementById(variationLineControlId('vo-1', 'contractLineId'))!;
    expect(baseline.textContent).toBe(at('variations.line.newScope'));
    const unit = document.getElementById(variationLineControlId('vo-1', 'unit'))!;
    expect(unit.textContent).toBe(at('priceBook.units.lump_sum'));
  });

  test('the "Amount" header of the payments received is LTR like the amounts under it', () => {
    show(
      <PaymentsLedger
        payments={{ rows: [{ id: 'p-1', requestNumber: 'PR-2026-0001', amount: '512709.0000', receivedOn: '2026-10-23', method: null, reference: null, note: null }], nextCursor: null }}
        loading={false}
        m={(value) => value}
        onShowMore={() => {}}
      />,
    );
    const header = screen.getByRole('columnheader', { name: at('contracts.execution.payments.ledger.amount') });
    const amount = screen.getByRole('cell', { name: '512709.0000' });
    expect(header.getAttribute('dir')).toBe('ltr');
    expect(amount.getAttribute('dir')).toBe('ltr');
    expect(header.className).toContain('text-end');
    expect(amount.className).toContain('text-end');
  });
});
