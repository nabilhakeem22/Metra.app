import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ActionResult } from '@/lib/actions/result';
import type { ContractHeaderDetail } from '@/lib/contracts/queries';
import { variationLinePath } from '@/lib/variations/line-fields';
import { expectFieldErrorsRenderUnderFields } from '@/test/field-coverage';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { ContractHeaderForm } from './contract-header-form';
import { CONTRACT_HEADER_FIELDS } from './contract-header-input';
import { VO_LINE_COLUMNS, type VoLineColumn } from './use-variation-create';
import { VO_REASON_ID, VO_TITLE_ID } from './variation-create-form';
import { variationLineControlId } from './variation-line-row';
import { VariationRegister } from './variation-register';

// W2.8: the contract header and the new-variation-order form say each refusal
// under the box (or line cell) it is about (AC 19), in both locales.

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('@/i18n/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/routing')>()),
  useRouter: () => router,
}));
const contracts = vi.hoisted(() => ({ saveContractDraft: vi.fn() }));
vi.mock('@/lib/contracts/actions', () => contracts);
const lineReads = vi.hoisted(() => ({
  loadSectionLines: vi.fn(),
  searchBaselineLines: vi.fn(async () => ({ ok: true, data: { lines: [], hasMore: false } })),
}));
vi.mock('@/lib/contracts/lines-actions', () => lineReads);
const variations = vi.hoisted(() => ({
  createVariationDraft: vi.fn(),
  saveVariationDraft: vi.fn(),
  internalApproveVariation: vi.fn(),
  issueVariation: vi.fn(),
}));
vi.mock('@/lib/variations/actions', () => variations);

const DETAIL = {
  id: 'k-1',
  status: 'draft',
  sourceBoqId: null,
  signatureDate: null,
  startDate: null,
  endDate: null,
  advancePct: '10',
  retentionPct: '5',
  paymentTermsDays: null,
  defectsLiabilityDays: null,
  termsEn: null,
  termsAr: null,
} as unknown as ContractHeaderDetail;

const LINE_PATHS = VO_LINE_COLUMNS.map((column) => variationLinePath(0, column));
const columnOf = (path: string) => path.split('.')[2] as VoLineColumn;
/** The first row the form adds; its refusals are held by this key, not by position. */
const FIRST_ROW = 'vo-1';
const errorUnder = (row: string, column: VoLineColumn) =>
  document.getElementById(`${variationLineControlId(row, column)}-error`)?.textContent;

beforeEach(() => {
  for (const action of [...Object.values(contracts), ...Object.values(variations)]) action.mockReset();
});

describe.each<TestLocale>(['en', 'ar-EG'])('contract forms (%s)', (locale) => {
  const at = (key: string) => messageAt(locale, key);
  const show = (ui: React.ReactElement) => {
    document.documentElement.dir = locale === 'ar-EG' ? 'rtl' : 'ltr';
    renderWithIntl(ui, { locale });
  };
  const press = (name: string) => async () => {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name }));
    });
  };
  const openRegister = async () => {
    show(
      <VariationRegister
        contractId="k-1"
        contractStatus="issued"
        variations={[]}
        canDraftVariation
        canPriceVariation={false}
        pending={false}
        m={(v) => v}
        act={() => {}}
      />,
    );
    await press(at('variations.create'))();
  };
  const typeTitle = () =>
    fireEvent.change(document.getElementById(VO_TITLE_ID)!, { target: { value: 'Extra door' } });

  test('the contract header', async () => {
    show(<ContractHeaderForm detail={DETAIL} />);
    await expectFieldErrorsRenderUnderFields({
      fields: CONTRACT_HEADER_FIELDS,
      controlIdOf: (field) => `ch-${field}`,
      answerWith: (result: ActionResult) => contracts.saveContractDraft.mockResolvedValue(result),
      submit: press(at('contracts.saveDraft')),
      locale,
      typed: { 'ch-advancePct': '10' },
    });
  });

  test('a new variation order: title and reason', async () => {
    await openRegister();
    typeTitle();
    await expectFieldErrorsRenderUnderFields({
      fields: ['title', 'reason'],
      controlIdOf: (field) => (field === 'title' ? VO_TITLE_ID : VO_REASON_ID),
      answerWith: (result: ActionResult) => variations.createVariationDraft.mockResolvedValue(result),
      submit: press(at('variations.saveDraft')),
      locale,
      typed: { [VO_TITLE_ID]: 'Extra door' },
    });
  });

  test('a new variation order: every cell of a line', async () => {
    variations.createVariationDraft.mockResolvedValue({ ok: true, data: 'v-1' });
    await openRegister();
    typeTitle();
    await press(at('variations.line.add'))();
    await expectFieldErrorsRenderUnderFields({
      fields: LINE_PATHS,
      controlIdOf: (path) => variationLineControlId(FIRST_ROW, columnOf(path)),
      answerWith: (result: ActionResult) => variations.saveVariationDraft.mockResolvedValue(result),
      submit: press(at('variations.saveDraft')),
      locale,
    });
  });

  test('removing a line keeps the refusals of the other lines and of the title (C2)', async () => {
    variations.createVariationDraft.mockResolvedValue({ ok: true, data: 'v-1' });
    variations.saveVariationDraft.mockResolvedValue({
      ok: false,
      error: 'check_fields',
      fields: {
        title: { code: 'name_required' },
        [variationLinePath(0, 'qty')]: { code: 'not_a_number' },
        [variationLinePath(1, 'qty')]: { code: 'amount_too_large' },
        [variationLinePath(2, 'unitPrice')]: { code: 'not_negative' },
      },
    });
    await openRegister();
    typeTitle();
    for (let added = 0; added < 3; added += 1) await press(at('variations.line.add'))();
    await press(at('variations.saveDraft'))();
    const remove = () => screen.getAllByRole('button', { name: at('variations.line.remove') });
    fireEvent.click(remove()[1]);
    expect(errorUnder('vo-1', 'qty')).toBe(at('errors.field.not_a_number'));
    expect(document.getElementById(variationLineControlId('vo-2', 'qty'))).toBeNull();
    expect(errorUnder('vo-3', 'unitPrice')).toBe(at('errors.field.not_negative'));
    fireEvent.click(remove()[0]);
    expect(errorUnder('vo-3', 'unitPrice')).toBe(at('errors.field.not_negative'));
    expect(document.getElementById(`${VO_TITLE_ID}-error`)?.textContent).toBe(at('errors.name_required'));
  });

  test('a missing title is said under it before anything is sent', async () => {
    await openRegister();
    await press(at('variations.saveDraft'))();
    expect(variations.createVariationDraft).not.toHaveBeenCalled();
    expect(document.getElementById(`${VO_TITLE_ID}-error`)?.textContent).toBe(at('errors.name_required'));
    expect(document.activeElement?.id).toBe(VO_TITLE_ID);
  });

  test('the retry after a refused line saves the draft already opened, not a second one', async () => {
    variations.createVariationDraft.mockResolvedValue({ ok: true, data: 'v-1' });
    variations.saveVariationDraft.mockResolvedValueOnce({
      ok: false,
      error: 'check_fields',
      fields: { [variationLinePath(0, 'qty')]: { code: 'not_a_number' } },
    });
    variations.saveVariationDraft.mockResolvedValueOnce({ ok: true });
    await openRegister();
    typeTitle();
    await press(at('variations.line.add'))();
    await press(at('variations.saveDraft'))();
    expect(document.getElementById(`${variationLineControlId(FIRST_ROW, 'qty')}-error`)?.textContent).toBe(
      at('errors.field.not_a_number'),
    );
    await press(at('variations.saveDraft'))();
    expect(variations.createVariationDraft).toHaveBeenCalledTimes(1);
    expect(variations.saveVariationDraft).toHaveBeenCalledTimes(2);
    expect(variations.saveVariationDraft.mock.calls[1][0].id).toBe('v-1');
    expect(document.getElementById(VO_TITLE_ID)).toBeNull();
  });
});
