import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ActionResult } from '@/lib/actions/result';
import { todayInCairo } from '@/lib/automation/clock';
import type { ContractBillingView } from '@/lib/execution/billing/view';
import { CONTRACT_PAYMENT_FIELDS } from '@/lib/execution/payments/input';
import { REQUEST_TERM_FIELDS, VOID_REQUEST_FIELDS } from '@/lib/execution/requests/input';
import { formatMoneyExact } from '@/lib/format/money';
import { expectFieldErrorsRenderUnderFields } from '@/test/field-coverage';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { paymentAttemptStorageKey } from './payment-attempt-store';
import { recordPaymentControlId, RecordPaymentDialog } from './record-payment-dialog';
import { sendRequestControlId, SendRequestDialog, type RequestTarget } from './send-request-dialog';
import { voidRequestControlId, VoidRequestDialog } from './void-request-dialog';

// PR A4.3 and its fix round: the Payments tab's three dialogs say every refusal
// under the box it is about, in both locales (the forms-registry contract); a
// payment past what is due is said under the amount with that figure as money
// (F7); a schedule row larger than what is left to bill is warned about and
// still sendable, and the server's own warning is said once it is sent (F3);
// and a payment whose answer was lost is never recorded twice (F1, F2): its
// key outlives the dialog, a retry carries it, and a different payment waits
// until the studio has checked the payments.

const requests = vi.hoisted(() => ({
  issueMilestoneRequest: vi.fn(),
  issueVariationRequest: vi.fn(),
  voidPaymentRequest: vi.fn(),
}));
vi.mock('@/lib/execution/requests/actions', () => requests);
const payments = vi.hoisted(() => ({ recordContractPayment: vi.fn() }));
vi.mock('@/lib/execution/payments/actions', () => payments);

const CONTRACT = 'c0000000-0000-4000-8000-000000000001';
const REQUEST = { id: 'r0000000-0000-4000-8000-000000000004', documentNumber: 'PR-2026-0004', outstanding: '500.0000' };
const MILESTONE: RequestTarget = { kind: 'milestone', id: 'm-1', label: 'Handover', amount: '24800.0000' };
const VIEW = { contractId: CONTRACT } as ContractBillingView;
const m = (value: string) => value;
const TODAY = todayInCairo(new Date());

beforeEach(() => {
  for (const action of [...Object.values(requests), ...Object.values(payments)]) action.mockReset();
  sessionStorage.clear();
});

describe.each<TestLocale>(['en', 'ar-EG'])('the Payments tab dialogs (%s)', (locale) => {
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
  const keysSent = () => payments.recordContractPayment.mock.calls.map(([input]) => input.idempotencyKey as string);
  const recordDialog = (props: Partial<Parameters<typeof RecordPaymentDialog>[0]> = {}) => (
    <RecordPaymentDialog
      contractId={CONTRACT}
      contractIssuedOn="2020-01-01"
      request={REQUEST}
      m={m}
      onAnswered={vi.fn()}
      onAlreadyRecorded={vi.fn()}
      onCheckPayments={vi.fn().mockResolvedValue(true)}
      onClose={vi.fn()}
      {...props}
    />
  );
  const saveRecord = press(at('contracts.execution.payments.record.submit'));

  test('send a payment request: the due day and the note', async () => {
    show(<SendRequestDialog contractId={CONTRACT} target={MILESTONE} balance="100000.0000" m={m} onAnswered={vi.fn()} onClose={vi.fn()} />);
    await expectFieldErrorsRenderUnderFields({
      fields: REQUEST_TERM_FIELDS,
      controlIdOf: sendRequestControlId,
      answerWith: (result: ActionResult) => requests.issueMilestoneRequest.mockResolvedValue(result),
      submit: press(at('contracts.execution.payments.send.submit')),
      locale,
    });
  });

  test('record a payment: every box, and past what is due under the amount, said as money', async () => {
    show(recordDialog());
    await expectFieldErrorsRenderUnderFields({
      fields: CONTRACT_PAYMENT_FIELDS,
      controlIdOf: recordPaymentControlId,
      answerWith: (result: ActionResult) => payments.recordContractPayment.mockResolvedValue(result),
      submit: saveRecord,
      locale,
      typed: { [recordPaymentControlId('amount')]: '500' },
    });
    payments.recordContractPayment.mockResolvedValue({
      ok: false,
      error: 'check_fields',
      fields: { amount: { code: 'payment_exceeds_request', params: { outstanding: '31248.0005' } } },
    });
    type(recordPaymentControlId('amount'), '60000');
    await saveRecord();
    const said = document.getElementById(`${recordPaymentControlId('amount')}-error`)?.textContent;
    expect(said).toBe(at('errors.payment_exceeds_request').replace('{outstanding}', formatMoneyExact('31248.0005', locale)));
    expect(said).not.toContain('31248.0005');
  });

  test('void a request: the reason', async () => {
    show(<VoidRequestDialog contractId={CONTRACT} request={REQUEST} onAnswered={vi.fn()} onClose={vi.fn()} />);
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

  test('a row above what is left to bill is warned about and sent; the server\'s warning keeps the dialog open to say it', async () => {
    const onAnswered = vi.fn();
    const onClose = vi.fn();
    show(<SendRequestDialog contractId={CONTRACT} target={MILESTONE} balance="12400.0000" m={m} onAnswered={onAnswered} onClose={onClose} />);
    expect(screen.getByText(at('contracts.execution.payments.send.overBalance'))).toBeTruthy();
    requests.issueMilestoneRequest.mockResolvedValue({ ok: true, data: 'r-9', balanceWarning: { balance: '12400.0000' }, view: VIEW });
    await press(at('contracts.execution.payments.send.submit'))();
    expect(requests.issueMilestoneRequest).toHaveBeenCalledWith({ milestoneId: 'm-1', dueOn: '', note: '' }, { contractId: CONTRACT });
    expect(onAnswered).toHaveBeenCalledWith(VIEW);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain(at('contracts.execution.payments.send.sent'));
    expect(screen.getByRole('status').textContent).toContain(at('contracts.execution.payments.send.sentOverBalance'));
    // Its one button now closes it: nothing can be sent twice from here.
    expect(screen.queryByRole('button', { name: at('contracts.execution.payments.send.submit') })).toBeNull();
    const closeButton = screen.getAllByRole('button', { name: at('common.close') }).find((button) => button.getAttribute('type') === 'submit');
    await act(async () => {
      fireEvent.click(closeButton!);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(requests.issueMilestoneRequest).toHaveBeenCalledTimes(1);
  });

  test('a contract already fully billed says so, never a figure below zero (F11)', async () => {
    show(<SendRequestDialog contractId={CONTRACT} target={MILESTONE} balance="-30752.0000" m={m} onAnswered={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(at('contracts.execution.payments.send.alreadyCovered'))).toBeTruthy();
    expect(screen.queryByText('-30752.0000')).toBeNull();
  });

  test('a failed send still re-reads the tab, and keeps the dialog open on the refusal', async () => {
    const onAnswered = vi.fn();
    const onClose = vi.fn();
    show(<SendRequestDialog contractId={CONTRACT} target={MILESTONE} balance="100000.0000" m={m} onAnswered={onAnswered} onClose={onClose} />);
    requests.issueMilestoneRequest.mockResolvedValue({ ok: false, error: 'contract_not_active' });
    await press(at('contracts.execution.payments.send.submit'))();
    expect(onAnswered).toHaveBeenCalledWith(undefined);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe(at('errors.contract_not_active'));
  });

  test('a lost answer: the key outlives the dialog, the retry after a remount carries it, and "already" closes it', async () => {
    payments.recordContractPayment.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const first = show(recordDialog());
    type(recordPaymentControlId('amount'), '5000');
    await saveRecord();
    const [lost] = keysSent();
    expect(sessionStorage.getItem(paymentAttemptStorageKey(CONTRACT, REQUEST.id))).toContain(lost);
    first.unmount();

    // A tab switch and back: a new dialog on the same request.
    const onAlreadyRecorded = vi.fn();
    const onClose = vi.fn();
    const onAnswered = vi.fn();
    payments.recordContractPayment.mockResolvedValueOnce({ ok: true, data: 'p-1', already: true, view: VIEW });
    show(recordDialog({ onAlreadyRecorded, onClose, onAnswered }));
    type(recordPaymentControlId('amount'), '5000');
    await saveRecord();
    expect(keysSent()[1]).toBe(lost);
    expect(payments.recordContractPayment.mock.calls[1][1]).toEqual({ contractId: CONTRACT });
    expect(onAnswered).toHaveBeenCalledWith(VIEW);
    expect(onAlreadyRecorded).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(paymentAttemptStorageKey(CONTRACT, REQUEST.id))).toBeNull();
  });

  test('a different payment while a key is held is not sent: check the payments first, then it gets a new key', async () => {
    payments.recordContractPayment.mockResolvedValueOnce({ ok: false, error: 'uncertain' });
    const first = show(recordDialog());
    type(recordPaymentControlId('amount'), '5000');
    await saveRecord();
    const [held] = keysSent();
    first.unmount();

    const onCheckPayments = vi.fn().mockResolvedValue(true);
    const onClose = vi.fn();
    const second = show(recordDialog({ onCheckPayments, onClose }));
    // The amount opens on what is due: a different payment from the one in doubt.
    await saveRecord();
    expect(payments.recordContractPayment).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-previous-attempt]')?.textContent).toContain(at('contracts.execution.payments.record.previousAttempt'));
    await press(at('contracts.execution.payments.record.checkPayments'))();
    expect(onCheckPayments).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(paymentAttemptStorageKey(CONTRACT, REQUEST.id))).toBeNull();
    second.unmount();

    payments.recordContractPayment.mockResolvedValueOnce({ ok: true, data: 'p-2', already: false, view: VIEW });
    show(recordDialog());
    await saveRecord();
    expect(keysSent()[1]).not.toBe(held);
  });

  test('a check that cannot read the payments keeps the key and says so', async () => {
    payments.recordContractPayment.mockResolvedValueOnce({ ok: false, error: 'uncertain' });
    const first = show(recordDialog());
    type(recordPaymentControlId('amount'), '5000');
    await saveRecord();
    first.unmount();
    show(recordDialog({ onCheckPayments: vi.fn().mockResolvedValue(false) }));
    await saveRecord();
    await press(at('contracts.execution.payments.record.checkPayments'))();
    expect(screen.getByRole('alert').textContent).toBe(at('contracts.execution.payments.record.checkFailed'));
    expect(sessionStorage.getItem(paymentAttemptStorageKey(CONTRACT, REQUEST.id))).not.toBeNull();
  });

  test('a definite refusal releases the key and re-reads the tab; the box keeps what was typed', async () => {
    const onAnswered = vi.fn();
    payments.recordContractPayment.mockResolvedValueOnce({ ok: false, error: 'request_void' });
    show(recordDialog({ onAnswered }));
    await saveRecord();
    expect(onAnswered).toHaveBeenCalledWith(undefined);
    expect(screen.getByRole('alert').textContent).toBe(at('errors.request_void'));
    expect(sessionStorage.getItem(paymentAttemptStorageKey(CONTRACT, REQUEST.id))).toBeNull();
  });

  test('the dialog refuses a fifth decimal, a two-digit year and a day before the contract, before sending (F5, F8)', async () => {
    show(recordDialog({ contractIssuedOn: TODAY }));
    const errorUnder = (field: 'amount' | 'receivedOn') => document.getElementById(`${recordPaymentControlId(field)}-error`)?.textContent;
    type(recordPaymentControlId('amount'), '100.12345');
    type(recordPaymentControlId('receivedOn'), '0026-10-20');
    await saveRecord();
    expect(errorUnder('amount')).toBe(at('errors.field.too_many_decimals').replace('{max}', '4'));
    expect(errorUnder('receivedOn')).toBe(at('errors.invalid_date'));
    type(recordPaymentControlId('amount'), '100');
    type(recordPaymentControlId('receivedOn'), '2001-01-01');
    await saveRecord();
    expect(errorUnder('receivedOn')).toContain(at('errors.field.date_before_issue').split('{date}')[0]);
    expect(payments.recordContractPayment).not.toHaveBeenCalled();
  });
});
