import { act, fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ActionResult } from '@/lib/actions/result';
import { todayInCairo } from '@/lib/automation/clock';
import { PAPER_DECISION_FIELDS } from '@/lib/variations/decide-on-paper-input';
import type { VariationListRow } from '@/lib/variations/queries';
import { expectFieldErrorsRenderUnderFields } from '@/test/field-coverage';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { variationPaperControlId } from './variation-paper-dialog';
import { VariationTable } from './variation-table';

// H7.3 (AC 32): the studio records the client's answer to an issued change
// order, given on paper, from the register. Every refusal sits under its box in
// both locales, no answer is picked in advance, each opening starts blank on
// today in Cairo, nothing closes the sheet while the save is pending, any
// answer re-reads the register, and the caret goes back to the row.

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

/** The register, with the paper answer offered unless `canDecideOnPaper` is false. */
function registerOf(rows: VariationListRow[], canDecideOnPaper = true) {
  return (
    <VariationTable variations={rows} chargeRates={null} canPriceVariation={false} canDecideOnPaper={canDecideOnPaper} pending={false} m={(v) => v} act={() => {}} />
  );
}

/** The register as the page holds it: `reread.rows` stands in for the rows a refresh brings back. */
function ReReadRegister({ reread }: { reread: { rows?: (rows: VariationListRow[]) => void } }) {
  const [rows, setRows] = useState([row({})]);
  reread.rows = setRows;
  return registerOf(rows);
}

/** A save held open until the test answers it. */
function heldSave() {
  let answer!: (result: ActionResult) => void;
  let fail!: (reason: unknown) => void;
  variations.recordVariationDecisionOnPaper.mockReturnValue(
    new Promise<ActionResult>((resolve, reject) => {
      answer = resolve;
      fail = reject;
    }),
  );
  return {
    answer: (result: ActionResult) => act(async () => answer(result)),
    fail: (reason: unknown) => act(async () => fail(reason)),
  };
}

/** Radix moves the caret back a tick after the sheet is gone. */
const afterClose = () => act(async () => new Promise((done) => setTimeout(done, 0)));

beforeEach(() => {
  for (const action of Object.values(variations)) action.mockReset();
  router.refresh.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe.each<TestLocale>(['en', 'ar-EG'])('the paper answer to a change order (%s)', (locale) => {
  const at = (key: string) => messageAt(locale, key);
  const cancel = () => at('common.cancel');
  const press = (name: string) => async () => {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name }));
    });
  };
  const paperButton = () => screen.getByRole('button', { name: at('variations.paper.open') });
  const render = (rows: VariationListRow[], canDecideOnPaper = true) => {
    document.documentElement.dir = locale === 'ar-EG' ? 'rtl' : 'ltr';
    return renderWithIntl(registerOf(rows, canDecideOnPaper), { locale });
  };
  const open = async () => {
    render([row({})]);
    paperButton().focus();
    await press(at('variations.paper.open'))();
  };
  const choose = (decision: 'approve' | 'reject') =>
    fireEvent.click(screen.getByRole('radio', { name: at(`variations.paper.${decision}`) }));
  const dayBox = () => document.getElementById(variationPaperControlId('decidedOn')) as HTMLInputElement;
  const noteBox = () => document.getElementById(variationPaperControlId('note')) as HTMLTextAreaElement;
  const refusalUnder = (field: 'decision' | 'decidedOn') =>
    document.getElementById(`${variationPaperControlId(field)}-error`)?.textContent;

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

  test('a day before the order was issued is said about the change order and its issue day (F2)', async () => {
    await open();
    choose('approve');
    variations.recordVariationDecisionOnPaper.mockResolvedValue({
      ok: false,
      error: 'check_fields',
      fields: { decidedOn: { code: 'date_before_variation_issue', params: { date: '23/10/2026' } } },
    });
    await press(at('variations.paper.submit'))();
    expect(refusalUnder('decidedOn')).toBe(at('errors.field.date_before_variation_issue').replace('{date}', '23/10/2026'));
  });

  test('the answers are a group named by its visible label, and no <label> points at it (F6)', async () => {
    await open();
    const group = screen.getByRole('radiogroup', { name: new RegExp(at('variations.paper.decision')) });
    expect(group.id).toBe(variationPaperControlId('decision'));
    expect(group.hasAttribute('aria-label')).toBe(false);
    expect(document.querySelector(`label[for="${group.id}"]`)).toBeNull();
    expect(document.getElementById(group.getAttribute('aria-labelledby')!)?.textContent).toContain(at('variations.paper.decision'));
  });

  test('no answer is picked in advance: Save without one is refused under it and sends nothing', async () => {
    await open();
    expect(screen.getAllByRole('radio').every((radio) => !(radio as HTMLInputElement).checked)).toBe(true);
    await press(at('variations.paper.submit'))();
    expect(variations.recordVariationDecisionOnPaper).not.toHaveBeenCalled();
    expect(refusalUnder('decision')).toBe(at('errors.field.required'));
    expect(document.activeElement?.id).toBe(variationPaperControlId('decision'));
  });

  test('sends the chosen answer, the day and the note, closes, re-reads the register and puts the caret on the row (F4)', async () => {
    await open();
    variations.recordVariationDecisionOnPaper.mockResolvedValue({ ok: true });
    choose('reject');
    fireEvent.change(noteBox(), { target: { value: 'Signed at the site' } });
    await press(at('variations.paper.submit'))();
    expect(variations.recordVariationDecisionOnPaper).toHaveBeenCalledWith({
      variationOrderId: 'v-1',
      decision: 'reject',
      decidedOn: todayInCairo(new Date()),
      note: 'Signed at the site',
    });
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    await afterClose();
    expect(document.activeElement).toBe(paperButton().closest('tr'));
  });

  test('Cancel and Escape put the caret back on the row\'s paper button (F4)', async () => {
    await open();
    await press(cancel())();
    await afterClose();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(paperButton());
    await press(at('variations.paper.open'))();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await afterClose();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(paperButton());
  });

  test('while the save is pending nothing closes it; the late refusal is shown and re-reads the register (F3)', async () => {
    await open();
    const save = heldSave();
    choose('approve');
    await press(at('variations.paper.submit'))();
    const dialog = screen.getByRole('dialog');
    for (const name of [cancel(), at('common.close')]) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled, name).toBe(true);
    }
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await act(async () => {});
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(router.refresh).not.toHaveBeenCalled();

    await save.answer({ ok: false, error: 'variation_not_issued' });
    expect(screen.getByRole('alert').textContent).toBe(at('errors.variation_not_issued'));
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect((screen.getByRole('button', { name: cancel() }) as HTMLButtonElement).disabled).toBe(false);
  });

  test('a contract ended meanwhile is said as an ended contract, not as a billing refusal', async () => {
    await open();
    variations.recordVariationDecisionOnPaper.mockResolvedValue({ ok: false, error: 'variation_contract_ended' });
    choose('reject');
    await press(at('variations.paper.submit'))();
    expect(screen.getByRole('alert').textContent).toBe(at('errors.variation_contract_ended'));
    expect(screen.getByRole('alert').textContent).not.toBe(at('errors.contract_not_active'));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  test('a save whose answer never came is said, and the register is re-read too (F3)', async () => {
    await open();
    const save = heldSave();
    choose('approve');
    await press(at('variations.paper.submit'))();
    await save.fail(new Error('network down'));
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  test('when the re-read shows the order decided meanwhile, the dialog keeps its refusal and the caret lands on the row (F3)', async () => {
    const reread: { rows?: (rows: VariationListRow[]) => void } = {};
    renderWithIntl(<ReReadRegister reread={reread} />, { locale });
    await press(at('variations.paper.open'))();
    variations.recordVariationDecisionOnPaper.mockResolvedValue({ ok: false, error: 'variation_not_issued' });
    choose('approve');
    await press(at('variations.paper.submit'))();
    // The refresh brings the order back approved: its row loses the button.
    act(() => reread.rows!([row({ status: 'approved' })]));
    expect(screen.queryByRole('button', { name: at('variations.paper.open') })).toBeNull();
    expect(screen.getByRole('alert').textContent).toBe(at('errors.variation_not_issued'));
    await press(cancel())();
    await afterClose();
    expect(document.activeElement?.id).toBe('variation-row-v-1');
  });

  test('reopening after Cancel starts blank: no answer, no note, today (F5)', async () => {
    await open();
    choose('approve');
    fireEvent.change(noteBox(), { target: { value: 'x' } });
    fireEvent.change(dayBox(), { target: { value: '2026-01-02' } });
    await press(cancel())();
    await press(at('variations.paper.open'))();
    expect(screen.getAllByRole('radio').every((radio) => !(radio as HTMLInputElement).checked)).toBe(true);
    expect(noteBox().value).toBe('');
    expect(dayBox().value).toBe(todayInCairo(new Date()));
  });

  test('the day is today in Cairo when the dialog opens, not when the page loaded (F9)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 23:30 on Oct 26 in Cairo (summer time, +03), as the register loads.
    vi.setSystemTime(new Date('2026-10-26T20:30:00Z'));
    render([row({})]);
    // The page stays open past midnight in Cairo.
    vi.setSystemTime(new Date('2026-10-26T22:30:00Z'));
    await press(at('variations.paper.open'))();
    expect(dayBox().value).toBe('2026-10-27');
    expect(dayBox().max).toBe('2026-10-27');
  });

  test('the register offers it only on an issued order, and only to a role that may record it', () => {
    const rows = [row({ id: 'v-1', status: 'issued' }), row({ id: 'v-2', number: 4, status: 'approved' })];
    const view = render(rows);
    expect(screen.getAllByRole('button', { name: at('variations.paper.open') })).toHaveLength(1);
    view.unmount();
    render(rows, false);
    expect(screen.queryByRole('button', { name: at('variations.paper.open') })).toBeNull();
  });
});
