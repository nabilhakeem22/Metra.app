import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ActionResult } from '@/lib/actions/result';
import { todayInCairo } from '@/lib/automation/clock';
import { PAPER_DECISION_FIELDS } from '@/lib/variations/decide-on-paper-input';
import type { VariationListRow } from '@/lib/variations/queries';
import { expectFieldErrorsRenderUnderFields } from '@/test/field-coverage';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { variationPaperControlId, VariationPaperDialog } from './variation-paper-dialog';
import { VariationTable } from './variation-table';

// H7.3 (AC 32): the studio records the client's answer to an issued change
// order, given on paper. Every refusal sits under its box in both locales, no
// answer is picked in advance, and the register offers it only on an issued
// order to a role that may record it.

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('@/i18n/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/routing')>()),
  useRouter: () => router,
}));
const variations = vi.hoisted(() => ({
  internalApproveVariation: vi.fn(),
  issueVariation: vi.fn(),
  recordVariationDecisionOnPaper: vi.fn(),
}));
vi.mock('@/lib/variations/actions', () => variations);

function row(overrides: Partial<VariationListRow>): VariationListRow {
  return {
    id: 'v-1',
    number: 3,
    titleAr: 'باب إضافي',
    titleEn: 'Extra door',
    status: 'issued',
    netDelta: '10000.0000',
    timeExtensionDays: null,
    contractId: 'k-1',
    contractNumber: 7,
    createdAt: '2026-10-20T10:00:00.000Z',
    rejectionChannel: null,
    ...overrides,
  };
}

beforeEach(() => {
  for (const action of Object.values(variations)) action.mockReset();
  router.refresh.mockReset();
});

describe.each<TestLocale>(['en', 'ar-EG'])('the paper answer to a change order (%s)', (locale) => {
  const at = (key: string) => messageAt(locale, key);
  const press = (name: string) => async () => {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name }));
    });
  };
  const open = async () => {
    document.documentElement.dir = locale === 'ar-EG' ? 'rtl' : 'ltr';
    renderWithIntl(<VariationPaperDialog variationOrderId="v-1" number="VO-2026-0003" />, { locale });
    await press(at('variations.paper.open'))();
  };
  const choose = (decision: 'approve' | 'reject') =>
    fireEvent.click(screen.getByRole('radio', { name: at(`variations.paper.${decision}`) }));

  test('says the order it records the answer to', async () => {
    await open();
    expect(screen.getByText(at('variations.paper.description').replace('{number}', 'VO-2026-0003'))).toBeTruthy();
  });

  test('every refusal under its box: the answer, the day and the note', async () => {
    await open();
    choose('approve');
    await expectFieldErrorsRenderUnderFields({
      fields: PAPER_DECISION_FIELDS,
      controlIdOf: variationPaperControlId,
      answerWith: (result: ActionResult) => variations.recordVariationDecisionOnPaper.mockResolvedValue(result),
      submit: press(at('variations.paper.submit')),
      locale,
    });
  });

  test('no answer is picked in advance: Save without one is refused under it and sends nothing', async () => {
    await open();
    expect(screen.getAllByRole('radio').every((radio) => !(radio as HTMLInputElement).checked)).toBe(true);
    await press(at('variations.paper.submit'))();
    expect(variations.recordVariationDecisionOnPaper).not.toHaveBeenCalled();
    expect(document.getElementById(`${variationPaperControlId('decision')}-error`)?.textContent).toBe(
      at('errors.field.required'),
    );
    expect(document.activeElement?.id).toBe(variationPaperControlId('decision'));
  });

  test('sends the chosen answer, the day and the note, then refreshes', async () => {
    await open();
    variations.recordVariationDecisionOnPaper.mockResolvedValue({ ok: true });
    choose('reject');
    fireEvent.change(document.getElementById(variationPaperControlId('note'))!, { target: { value: 'Signed at the site' } });
    await press(at('variations.paper.submit'))();
    expect(variations.recordVariationDecisionOnPaper).toHaveBeenCalledWith({
      variationOrderId: 'v-1',
      decision: 'reject',
      decidedOn: todayInCairo(new Date()),
      note: 'Signed at the site',
    });
    expect(router.refresh).toHaveBeenCalled();
  });

  test('a decision the client made online meanwhile is said above the footer', async () => {
    await open();
    variations.recordVariationDecisionOnPaper.mockResolvedValue({ ok: false, error: 'variation_not_issued' });
    choose('approve');
    await press(at('variations.paper.submit'))();
    expect(screen.getByText(at('errors.variation_not_issued'))).toBeTruthy();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  test('the register offers it only on an issued order, and only to a role that may record it', () => {
    const rows = [row({ id: 'v-1', status: 'issued' }), row({ id: 'v-2', number: 4, status: 'approved' })];
    const view = renderWithIntl(
      <VariationTable variations={rows} chargeRates={null} canPriceVariation={false} canDecideOnPaper pending={false} m={(v) => v} act={() => {}} />,
      { locale },
    );
    expect(screen.getAllByRole('button', { name: at('variations.paper.open') })).toHaveLength(1);
    view.unmount();
    renderWithIntl(
      <VariationTable variations={rows} chargeRates={null} canPriceVariation={false} canDecideOnPaper={false} pending={false} m={(v) => v} act={() => {}} />,
      { locale },
    );
    expect(screen.queryByRole('button', { name: at('variations.paper.open') })).toBeNull();
  });
});
