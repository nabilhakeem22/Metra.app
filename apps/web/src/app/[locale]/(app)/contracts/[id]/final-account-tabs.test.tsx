import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { FinalAccountView } from '@/lib/execution/final-account/load';
import type { MeasurementsView } from '@/lib/execution/measurements/read-core';
import type { CostSheet } from '@/lib/execution/money/cost-sheet-types';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { CostSheetTab } from './cost-sheet-tab';
import { FinalAccountCard } from './final-account-card';
import { MeasurementsTab } from './measurements-tab';

// PR A5: the measurements tab, the final account card and the cost sheet tab
// read themselves on demand and offer only what the server would accept: no
// "Record" once the final account is issued, no "Issue" while a change order
// is open or for a role without invoices_issue, no margin the server left out.

const measurements = vi.hoisted(() => ({ loadMeasurements: vi.fn(), recordMeasurement: vi.fn() }));
vi.mock('@/lib/execution/measurements/actions', () => measurements);
const finalAccount = vi.hoisted(() => ({ loadFinalAccount: vi.fn(), loadFinalAccountDifferences: vi.fn(), issueFinalAccount: vi.fn() }));
vi.mock('@/lib/execution/final-account/actions', () => finalAccount);
const costSheet = vi.hoisted(() => ({ loadCostSheet: vi.fn() }));
vi.mock('@/lib/execution/cost-sheet/actions', () => costSheet);

const CONTRACT = 'c0000000-0000-4000-8000-000000000001';
const m = (value: string) => `EGP ${value}`;

const LINE = {
  id: 'l-1', sectionTitleAr: null, sectionTitleEn: 'Ceilings', itemCode: 'A-5', descriptionAr: null, descriptionEn: 'Gypsum',
  unit: 'sqm', qty: '200.0000', variationQty: '0.0000', provisional: true, latest: null,
};

function measurementsView(contract: Partial<MeasurementsView['contract']> = {}): MeasurementsView {
  return {
    contract: {
      id: CONTRACT, number: 7, createdAt: '2026-10-01T08:00:00.000Z', titleAr: null, titleEn: 'Villa', clientNameAr: null,
      clientNameEn: 'Client', status: 'signed', issuedOn: '2026-10-01', finalAccountIssued: false, ...contract,
    },
    page: { lines: [LINE], nextCursor: null },
  };
}

const FIGURES = {
  variationsCharge: '0.0000', adjustmentWorks: '4000.0000', adjustmentCharge: '4960.0000',
  finalValue: '128960.0000', billedSoFar: '124000.0000', balance: '4960.0000',
};

function account(overrides: Partial<FinalAccountView> = {}): FinalAccountView {
  return {
    contractId: CONTRACT, status: 'signed', originalValue: '124000.0000', figures: FIGURES, openVariationCount: 0, issued: null,
    counts: { billed: 1, flagged: 0 }, differences: { rows: [], nextCursor: null }, ...overrides,
  };
}

const SHEET: CostSheet = {
  value: { originalValue: '124000.0000', approvedVariations: '0.0000', revisedValue: '124000.0000', valueExVat: '110000.0000' },
  billing: { requested: '0.0000', paid: '0.0000', outstanding: '0.0000' },
  sections: [{ kind: 'section', sectionId: 's-1', titleAr: null, titleEn: 'Ceilings', count: null, budgetCost: '100.0000', actualCost: '150.0000', variance: '50.0000', overBudget: true }],
  totals: { budgetCost: '100.0000', actualCost: '150.0000' },
  margin: null,
};

beforeEach(() => {
  for (const action of [...Object.values(measurements), ...Object.values(finalAccount), ...Object.values(costSheet)]) action.mockReset();
});

describe.each<TestLocale>(['en', 'ar-EG'])('the A5 tabs (%s)', (locale) => {
  const at = (key: string) => messageAt(locale, key);
  const show = async (ui: React.ReactElement) => {
    await act(async () => {
      renderWithIntl(ui, { locale });
    });
  };

  test('measurements: the lines with their final measured quantity, "Record" while the contract is open', async () => {
    measurements.loadMeasurements.mockResolvedValue({ ok: true, data: measurementsView() });
    await show(<MeasurementsTab contractId={CONTRACT} canRecord />);
    expect(measurements.loadMeasurements).toHaveBeenCalledWith({ contractId: CONTRACT, afterLineId: null, provisionalOnly: false, query: '' });
    expect(screen.getByText(at('contracts.execution.measurements.notMeasured'))).toBeTruthy();
    expect(screen.getByRole('button', { name: at('contracts.execution.measurements.record.open') })).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox'));
    });
    expect(measurements.loadMeasurements).toHaveBeenLastCalledWith({ contractId: CONTRACT, afterLineId: null, provisionalOnly: true, query: '' });
  });

  test('measurements: no "Record" once the final account is issued, or for a role that only reads', async () => {
    measurements.loadMeasurements.mockResolvedValue({ ok: true, data: measurementsView({ finalAccountIssued: true }) });
    await show(<MeasurementsTab contractId={CONTRACT} canRecord />);
    expect(screen.getByText(at('contracts.execution.measurements.closed.finalAccountIssued'))).toBeTruthy();
    expect(screen.queryByRole('button', { name: at('contracts.execution.measurements.record.open') })).toBeNull();
  });

  test('final account: the figures and "Issue" for a role that may issue it', async () => {
    finalAccount.loadFinalAccount.mockResolvedValue({ ok: true, data: account() });
    await show(<FinalAccountCard contractId={CONTRACT} canIssue m={m} />);
    expect(screen.getAllByText(m('4960.0000')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: at('contracts.execution.finalAccount.issue.open') })).toBeTruthy();
  });

  test('final account: an open change order blocks it; a role without invoices_issue is told who issues it', async () => {
    finalAccount.loadFinalAccount.mockResolvedValue({ ok: true, data: account({ openVariationCount: 2 }) });
    await show(<FinalAccountCard contractId={CONTRACT} canIssue m={m} />);
    expect(screen.getByText(at('contracts.execution.finalAccount.blocked.openVariations').replace('{count}', '2'))).toBeTruthy();
    expect(screen.queryByRole('button', { name: at('contracts.execution.finalAccount.issue.open') })).toBeNull();
  });

  test('final account: once issued it shows the request and no "Issue"', async () => {
    const issued = { id: 'r-1', documentNumber: 'PR-2026-0009', amount: '4960.0000', paid: '0.0000', outstanding: '4960.0000' };
    finalAccount.loadFinalAccount.mockResolvedValue({ ok: true, data: account({ issued }) });
    await show(<FinalAccountCard contractId={CONTRACT} canIssue={false} m={m} />);
    expect(screen.getByText('PR-2026-0009')).toBeTruthy();
    expect(screen.getByText(at('contracts.execution.finalAccount.issued.note'))).toBeTruthy();
    expect(screen.queryByText(at('contracts.execution.finalAccount.someoneElse'))).toBeNull();
  });

  test('cost sheet: the sections against budget, and no margin when the server left it out', async () => {
    costSheet.loadCostSheet.mockResolvedValue({ ok: true, data: SHEET });
    await show(<CostSheetTab contractId={CONTRACT} m={m} />);
    expect(screen.getByText('Ceilings')).toBeTruthy();
    expect(screen.getByText(at('contracts.execution.costSheet.rows.overBudget'))).toBeTruthy();
    expect(screen.getByText(at('contracts.execution.costSheet.margin.hidden'))).toBeTruthy();
    expect(screen.queryByText(at('contracts.execution.costSheet.margin.projected'))).toBeNull();
  });
});
