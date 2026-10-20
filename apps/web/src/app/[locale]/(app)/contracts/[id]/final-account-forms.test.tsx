import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ActionResult } from '@/lib/actions/result';
import type { FinalAccountView } from '@/lib/execution/final-account/load';
import { MEASUREMENT_FIELDS } from '@/lib/execution/measurements/input';
import { REQUEST_TERM_FIELDS } from '@/lib/execution/requests/input';
import { formatMoneyExact } from '@/lib/format/money';
import { expectFieldErrorsRenderUnderFields } from '@/test/field-coverage';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { issueFinalAccountControlId, IssueFinalAccountDialog } from './issue-final-account-dialog';
import { recordMeasurementControlId, RecordMeasurementDialog } from './record-measurement-dialog';

// PR A5: the two dialogs of the final account's inputs say every refusal
// under the box it is about, in both locales (the forms-registry contract).
// A reading whose answer was lost is retried under the same key while its
// boxes are unchanged, and a changed box is a new reading; a final account
// whose balance moved is refused with the new balance said as money.

const measurements = vi.hoisted(() => ({ recordMeasurement: vi.fn(), loadMeasurements: vi.fn() }));
vi.mock('@/lib/execution/measurements/actions', () => measurements);
const finalAccount = vi.hoisted(() => ({ issueFinalAccount: vi.fn(), loadFinalAccount: vi.fn(), loadFinalAccountDifferences: vi.fn() }));
vi.mock('@/lib/execution/final-account/actions', () => finalAccount);

const CONTRACT = 'c0000000-0000-4000-8000-000000000001';
const LINE = { id: 'l0000000-0000-4000-8000-000000000002', label: 'A-5 Gypsum ceiling' };
const m = (value: string) => value;

beforeEach(() => {
  for (const action of [...Object.values(measurements), ...Object.values(finalAccount)]) action.mockReset();
});

describe.each<TestLocale>(['en', 'ar-EG'])('the final account dialogs (%s)', (locale) => {
  const at = (key: string) => messageAt(locale, key);
  const show = (ui: React.ReactElement) => {
    document.documentElement.dir = locale === 'ar-EG' ? 'rtl' : 'ltr';
    return renderWithIntl(ui, { locale });
  };
  const press = (name: string) => async () => {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name }));
    });
  };
  const type = (controlId: string, value: string) => fireEvent.change(document.getElementById(controlId)!, { target: { value } });
  const recordDialog = (onSaved = vi.fn()) => (
    <RecordMeasurementDialog contractId={CONTRACT} contractIssuedOn="2020-01-01" line={LINE} onSaved={onSaved} onClose={vi.fn()} />
  );
  const saveReading = press(at('contracts.execution.measurements.record.submit'));

  test('record a reading: the quantity, the day and the note', async () => {
    show(recordDialog());
    type(recordMeasurementControlId('measuredQty'), '12');
    await expectFieldErrorsRenderUnderFields({
      fields: MEASUREMENT_FIELDS,
      controlIdOf: recordMeasurementControlId,
      answerWith: (result: ActionResult) => measurements.recordMeasurement.mockResolvedValue(result),
      submit: saveReading,
      locale,
      typed: { [recordMeasurementControlId('measuredQty')]: '12' },
    });
  });

  test('a lost answer is retried under the same key; a changed quantity is a new reading', async () => {
    const onSaved = vi.fn();
    show(recordDialog(onSaved));
    type(recordMeasurementControlId('measuredQty'), '240');
    measurements.recordMeasurement.mockRejectedValueOnce(new Error('network'));
    await saveReading();
    measurements.recordMeasurement.mockResolvedValueOnce({ ok: false, error: 'busy' });
    await saveReading();
    type(recordMeasurementControlId('measuredQty'), '241');
    measurements.recordMeasurement.mockResolvedValueOnce({ ok: true, data: 'r-1', already: false });
    await saveReading();
    const keys = measurements.recordMeasurement.mock.calls.map(([input]) => input.idempotencyKey as string);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[1]);
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ measuredQty: '241.0000', note: null }), false);
  });

  test('the quantity typed in Arabic digits is rewritten on blur to the figure that is saved', () => {
    show(recordDialog());
    const box = document.getElementById(recordMeasurementControlId('measuredQty'))!;
    fireEvent.change(box, { target: { value: '١٬٢٥٠٫٥' } });
    fireEvent.blur(box);
    expect((box as HTMLInputElement).value).toBe('1250.5');
  });

  test('issue the final account: the due day and the note', async () => {
    show(<IssueFinalAccountDialog contractId={CONTRACT} amount="4960.0000" m={m} onAnswered={vi.fn().mockResolvedValue(null)} onClose={vi.fn()} />);
    await expectFieldErrorsRenderUnderFields({
      fields: REQUEST_TERM_FIELDS,
      controlIdOf: issueFinalAccountControlId,
      answerWith: (result: ActionResult) => finalAccount.issueFinalAccount.mockResolvedValue(result),
      submit: press(at('contracts.execution.finalAccount.issue.submit')),
      locale,
    });
  });

  test('a balance that moved is said with the new figure as money, and the card reads itself again', async () => {
    const onAnswered = vi.fn().mockResolvedValue({ issued: null } as FinalAccountView);
    const onClose = vi.fn();
    show(<IssueFinalAccountDialog contractId={CONTRACT} amount="4960.0000" m={m} onAnswered={onAnswered} onClose={onClose} />);
    finalAccount.issueFinalAccount.mockResolvedValue({ ok: false, error: 'final_account_changed', params: { amount: '5000.0000' } });
    await press(at('contracts.execution.finalAccount.issue.submit'))();
    expect(finalAccount.issueFinalAccount).toHaveBeenCalledWith({ contractId: CONTRACT, expectedAmount: '4960.0000', dueOn: '', note: '' });
    expect(onAnswered).toHaveBeenCalledWith();
    expect(onClose).not.toHaveBeenCalled();
    const said = at('errors.final_account_changed').replace('{amount}', formatMoneyExact('5000.0000', locale));
    expect(screen.getByText(said)).toBeTruthy();
  });

  test('a refusal after which the card shows the account issued closes the dialog on it', async () => {
    const onClose = vi.fn();
    const onAnswered = vi.fn().mockResolvedValue({ issued: { id: 'r-9' } } as FinalAccountView);
    show(<IssueFinalAccountDialog contractId={CONTRACT} amount="4960.0000" m={m} onAnswered={onAnswered} onClose={onClose} />);
    finalAccount.issueFinalAccount.mockResolvedValue({ ok: false, error: 'request_exists' });
    await press(at('contracts.execution.finalAccount.issue.submit'))();
    expect(onClose).toHaveBeenCalled();
  });
});
