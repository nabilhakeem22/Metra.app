import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ActionResult } from '@/lib/actions/result';
import { CONTRACT_PAYMENT_FIELDS } from '@/lib/execution/payments/input';
import { REQUEST_TERM_FIELDS, VOID_REQUEST_FIELDS } from '@/lib/execution/requests/input';
import { expectFieldErrorsRenderUnderFields } from '@/test/field-coverage';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { recordPaymentControlId, RecordPaymentDialog } from './record-payment-dialog';
import { sendRequestControlId, SendRequestDialog, type RequestTarget } from './send-request-dialog';
import { voidRequestControlId, VoidRequestDialog } from './void-request-dialog';

// PR A4.3: the Payments tab's three dialogs say every refusal under the box it
// is about, in both locales (the forms-registry contract); a payment past what
// is due is said under the amount with that figure; a schedule row larger than
// what is left to bill is warned about and still sendable; and a payment
// retried after an answer that could not say what happened carries the SAME
// idempotency key, a new payment a new one.

const requests = vi.hoisted(() => ({
  issueMilestoneRequest: vi.fn(),
  issueVariationRequest: vi.fn(),
  voidPaymentRequest: vi.fn(),
}));
vi.mock('@/lib/execution/requests/actions', () => requests);
const payments = vi.hoisted(() => ({ recordContractPayment: vi.fn() }));
vi.mock('@/lib/execution/payments/actions', () => payments);

const REQUEST = { id: 'r-1', documentNumber: 'PR-2026-0004', outstanding: '500.0000' };
const MILESTONE: RequestTarget = { kind: 'milestone', id: 'm-1', label: 'Handover', amount: '24800.0000' };
const m = (value: string) => value;

beforeEach(() => {
  for (const action of [...Object.values(requests), ...Object.values(payments)]) action.mockReset();
});

describe.each<TestLocale>(['en', 'ar-EG'])('the Payments tab dialogs (%s)', (locale) => {
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
  const type = (controlId: string, value: string) => fireEvent.change(document.getElementById(controlId)!, { target: { value } });

  test('send a payment request: the due day and the note', async () => {
    show(<SendRequestDialog target={MILESTONE} balance="100000.0000" m={m} onSent={vi.fn()} />);
    await press(at('contracts.execution.payments.send.open'))();
    await expectFieldErrorsRenderUnderFields({
      fields: REQUEST_TERM_FIELDS,
      controlIdOf: sendRequestControlId,
      answerWith: (result: ActionResult) => requests.issueMilestoneRequest.mockResolvedValue(result),
      submit: press(at('contracts.execution.payments.send.submit')),
      locale,
    });
  });

  test('record a payment: every box, and past what is due under the amount with the figure', async () => {
    show(<RecordPaymentDialog request={REQUEST} m={m} onRecorded={vi.fn()} />);
    await press(at('contracts.execution.payments.record.open'))();
    await expectFieldErrorsRenderUnderFields({
      fields: CONTRACT_PAYMENT_FIELDS,
      controlIdOf: recordPaymentControlId,
      answerWith: (result: ActionResult) => payments.recordContractPayment.mockResolvedValue(result),
      submit: press(at('contracts.execution.payments.record.submit')),
      locale,
      typed: { [recordPaymentControlId('amount')]: '500' },
    });
    payments.recordContractPayment.mockResolvedValue({
      ok: false,
      error: 'check_fields',
      fields: { amount: { code: 'payment_exceeds_request', params: { outstanding: '120.0000' } } },
    });
    type(recordPaymentControlId('amount'), '600');
    await press(at('contracts.execution.payments.record.submit'))();
    expect(document.getElementById(`${recordPaymentControlId('amount')}-error`)?.textContent).toBe(
      at('errors.payment_exceeds_request').replace('{outstanding}', '120.0000'),
    );
  });

  test('void a request: the reason', async () => {
    show(<VoidRequestDialog request={REQUEST} onVoided={vi.fn()} />);
    await press(at('contracts.execution.payments.void.open'))();
    type(voidRequestControlId('reason'), 'Sent twice');
    await expectFieldErrorsRenderUnderFields({
      fields: VOID_REQUEST_FIELDS,
      controlIdOf: voidRequestControlId,
      answerWith: (result: ActionResult) => requests.voidPaymentRequest.mockResolvedValue(result),
      submit: press(at('contracts.execution.payments.void.submit')),
      locale,
      typed: { [voidRequestControlId('reason')]: 'Sent twice' },
    });
  });

  test('a row above what is left to bill is warned about, and still sent', async () => {
    const onSent = vi.fn();
    show(<SendRequestDialog target={MILESTONE} balance="12400.0000" m={m} onSent={onSent} />);
    await press(at('contracts.execution.payments.send.open'))();
    expect(screen.getByText(at('contracts.execution.payments.send.overBalance'))).toBeTruthy();
    requests.issueMilestoneRequest.mockResolvedValue({ ok: true, data: 'r-9', balanceWarning: { balance: '12400.0000' } });
    await press(at('contracts.execution.payments.send.submit'))();
    expect(requests.issueMilestoneRequest).toHaveBeenCalledWith({ milestoneId: 'm-1', dueOn: '', note: '' });
    expect(onSent).toHaveBeenCalledTimes(1);
  });

  test('a retry after an unknown answer carries the same key; the next payment a new one', async () => {
    const onRecorded = vi.fn();
    show(<RecordPaymentDialog request={REQUEST} m={m} onRecorded={onRecorded} />);
    await press(at('contracts.execution.payments.record.open'))();
    const submit = press(at('contracts.execution.payments.record.submit'));
    payments.recordContractPayment.mockResolvedValueOnce({ ok: false, error: 'uncertain' }).mockResolvedValueOnce({ ok: true, data: 'p-1', already: true });
    await submit();
    await submit();
    const [first, retry] = payments.recordContractPayment.mock.calls.map(([input]) => input.idempotencyKey);
    expect(retry).toBe(first);
    // The retry found the first attempt landed: said, and the tab is told to read the ledger again.
    expect(screen.getByText(at('contracts.execution.payments.record.already'))).toBeTruthy();
    expect(onRecorded).toHaveBeenCalledTimes(1);
    payments.recordContractPayment.mockResolvedValueOnce({ ok: true, data: 'p-2', already: false });
    type(recordPaymentControlId('amount'), '100');
    await submit();
    expect(payments.recordContractPayment.mock.calls[2][0].idempotencyKey).not.toBe(first);
  });
});
