import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { VariationListRow } from '@/lib/variations/queries';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { ContractFinishDate } from './contract-finish-date';
import type { VariationChargeRates } from './contract-vo-types';
import { VO_DAYS_ID, VO_TITLE_ID } from './variation-create-form';
import { VariationRegister } from './variation-register';
import { VariationTable } from './variation-table';

// PR B5 (A24, D4a): an execution contract's change order may add days to the
// finish date, each order says what it charges the client, and the overview
// says the revised finish. A proposal contract's register is unchanged.

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('@/i18n/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/routing')>()),
  useRouter: () => router,
}));
vi.mock('@/lib/contracts/lines-actions', () => ({
  loadSectionLines: vi.fn(),
  searchBaselineLines: vi.fn(async () => ({ ok: true, data: { lines: [], hasMore: false } })),
}));
const variations = vi.hoisted(() => ({
  createVariationDraft: vi.fn(),
  saveVariationDraft: vi.fn(),
  internalApproveVariation: vi.fn(),
  issueVariation: vi.fn(),
}));
vi.mock('@/lib/variations/actions', () => variations);

const RATES: VariationChargeRates = { taxRate: '14.0000', supervisionPct: '10.0000' };

function row(overrides: Partial<VariationListRow> = {}): VariationListRow {
  return {
    id: 'v-1',
    number: 3,
    titleAr: 'باب إضافي',
    titleEn: 'Extra door',
    status: 'approved',
    netDelta: '10000.0000',
    timeExtensionDays: 15,
    contractId: 'k-1',
    contractNumber: 7,
    createdAt: '2026-10-20T10:00:00.000Z',
    rejectionChannel: null,
    ...overrides,
  };
}

beforeEach(() => {
  for (const action of Object.values(variations)) action.mockReset();
});

describe.each<TestLocale>(['en', 'ar-EG'])('change-order execution polish (%s)', (locale) => {
  const at = (key: string) => messageAt(locale, key);
  const press = async (name: string) => {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name }));
    });
  };
  const openRegister = async (chargeRates: VariationChargeRates | null) => {
    renderWithIntl(
      <VariationRegister
        contractId="k-1"
        contractStatus="signed"
        chargeRates={chargeRates}
        variations={[]}
        canDraftVariation
        canPriceVariation={false}
        pending={false}
        m={(value) => value}
        act={() => {}}
      />,
      { locale },
    );
    await press(at('variations.create'));
    fireEvent.change(document.getElementById(VO_TITLE_ID)!, { target: { value: 'Extra door' } });
  };
  const typeDays = (value: string) => {
    const box = document.getElementById(VO_DAYS_ID)!;
    fireEvent.change(box, { target: { value } });
    fireEvent.blur(box);
  };

  test('a proposal contract has no days box and sends no days', async () => {
    variations.createVariationDraft.mockResolvedValue({ ok: true, data: 'v-1' });
    await openRegister(null);
    expect(document.getElementById(VO_DAYS_ID)).toBeNull();
    await press(at('variations.saveDraft'));
    expect(variations.createVariationDraft.mock.calls[0][0].timeExtensionDays).toBeUndefined();
  });

  test('typed Arabic-Indic days become Latin digits and reach both the create and the save', async () => {
    variations.createVariationDraft.mockResolvedValue({ ok: true, data: 'v-1' });
    variations.saveVariationDraft.mockResolvedValue({ ok: true });
    await openRegister(RATES);
    typeDays('١٥');
    expect((document.getElementById(VO_DAYS_ID) as HTMLInputElement).value).toBe('15');
    await press(at('variations.line.add'));
    await press(at('variations.saveDraft'));
    expect(variations.createVariationDraft.mock.calls[0][0].timeExtensionDays).toBe('15');
    expect(variations.saveVariationDraft.mock.calls[0][0].header.timeExtensionDays).toBe('15');
  });

  test('days past 3650 are refused under the box before anything is sent', async () => {
    await openRegister(RATES);
    typeDays('4000');
    await press(at('variations.saveDraft'));
    expect(variations.createVariationDraft).not.toHaveBeenCalled();
    expect(document.getElementById(`${VO_DAYS_ID}-error`)?.textContent).toBe(
      messageAt(locale, 'errors.field.out_of_range').replace('{min}', '0').replace('{max}', '3650'),
    );
    expect(document.activeElement?.id).toBe(VO_DAYS_ID);
  });

  test('each order of an execution contract says its works, VAT, supervision, total and days (D4a)', () => {
    renderWithIntl(
      <VariationTable variations={[row()]} chargeRates={RATES} canPriceVariation={false} pending={false} m={(v) => v} act={() => {}} />,
      { locale },
    );
    for (const figure of ['10000.0000', '1400.0000', '1000.0000', '12400.0000']) {
      expect(screen.getAllByText(figure).length).toBeGreaterThan(0);
    }
    expect(screen.getByText(at('variations.charge.supervision'))).toBeTruthy();
    expect(document.body.textContent).toContain('15');
    expect(document.body.textContent).not.toMatch(/[٠-٩]/);
  });

  test('a proposal contract\'s register shows the net change alone, as before', () => {
    renderWithIntl(
      <VariationTable variations={[row({ timeExtensionDays: null })]} chargeRates={null} canPriceVariation={false} pending={false} m={(v) => v} act={() => {}} />,
      { locale },
    );
    expect(screen.queryByText(at('variations.charge.supervision'))).toBeNull();
    expect(screen.queryByText('12400.0000')).toBeNull();
  });

  test('the revised finish: the end date plus the approved days, or the days alone, or nothing', () => {
    const { unmount } = renderWithIntl(<ContractFinishDate endDate="2026-06-30" approvedExtensionDays={30} />, { locale });
    expect(document.body.textContent).toContain('30/07/2026');
    unmount();
    const noEnd = renderWithIntl(<ContractFinishDate endDate={null} approvedExtensionDays={30} />, { locale });
    expect(document.body.textContent).toContain('30');
    expect(document.body.textContent).not.toContain('/');
    noEnd.unmount();
    renderWithIntl(<ContractFinishDate endDate="2026-06-30" approvedExtensionDays={0} />, { locale });
    expect(document.body.textContent).toBe('');
  });
});
