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
const payments = vi.hoisted(() => ({ recordContractPayment: vi.fn(), checkPaymentAttempt: vi.fn() }));
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
    expect(onAnswered).toHaveBeenCalledWith();
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

  /** A first payment of 5,000 whose answer was lost, then the dialog reopened on the same request. */
  async function afterALostAnswer(props: Partial<Parameters<typeof RecordPaymentDialog>[0]> = {}) {
    payments.recordContractPayment.mockResolvedValueOnce({ ok: false, error: 'uncertain' });
    const first = show(recordDialog());
    type(recordPaymentControlId('amount'), '5000');
    await saveRecord();
    first.unmount();
    const reopened = show(recordDialog(props));
    // The amount opens on what is due: a different payment from the one in doubt.
    await saveRecord();
    return { held: keysSent()[0], reopened };
  }
  const check = press(at('contracts.execution.payments.record.checkPayments'));
  const stored = () => sessionStorage.getItem(paymentAttemptStorageKey(CONTRACT, REQUEST.id));
  const notice = () => document.querySelector('[data-previous-attempt]')?.textContent ?? '';
  const SENT_VIEW = { ...VIEW, schedule: [{ id: 'm-1', labelAr: null, labelEn: 'Handover', amount: '24800.0000', billed: true }] } as ContractBillingView;

  test('a different payment while a key is held is not sent; a check that finds the first one landed closes on it', async () => {
    const onClose = vi.fn();
    const onAlreadyRecorded = vi.fn();
    const onAnswered = vi.fn();
    const { held, reopened } = await afterALostAnswer({ onClose, onAlreadyRecorded, onAnswered });
    expect(payments.recordContractPayment).toHaveBeenCalledTimes(1);
    expect(notice()).toContain(at('contracts.execution.payments.record.previousAttempt'));
    payments.checkPaymentAttempt.mockResolvedValueOnce({ ok: true, data: { landed: true }, view: VIEW });
    await check();
    // Asked behind the request's lock, with the key in doubt, and the tab shown as it is now.
    expect(payments.checkPaymentAttempt).toHaveBeenCalledWith({ requestId: REQUEST.id, idempotencyKey: held }, { contractId: CONTRACT });
    expect(onAnswered).toHaveBeenCalledWith(VIEW);
    expect(onAlreadyRecorded).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(stored()).toBeNull();
    reopened.unmount();

    payments.recordContractPayment.mockResolvedValueOnce({ ok: true, data: 'p-2', already: false, view: VIEW });
    show(recordDialog());
    await saveRecord();
    expect(keysSent()[1]).not.toBe(held);
  });

  test('"not there" inside the write window keeps the key and asks to check again; past it, the key is released (N1)', async () => {
    const onClose = vi.fn();
    const { held } = await afterALostAnswer({ onClose });
    payments.checkPaymentAttempt.mockResolvedValue({ ok: true, data: { landed: false }, view: VIEW });
    await check();
    expect(notice()).toContain(at('contracts.execution.payments.record.stillRunning'));
    expect(onClose).not.toHaveBeenCalled();
    expect(stored()).toContain(held);
    const later = Date.now() + 20_001;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(later);
    try {
      await check();
    } finally {
      clock.mockRestore();
    }
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(stored()).toBeNull();
  });

  test('a check that cannot answer keeps the key and says so', async () => {
    await afterALostAnswer();
    payments.checkPaymentAttempt.mockResolvedValueOnce({ ok: false, error: 'uncertain' });
    await check();
    expect(notice()).toContain(at('contracts.execution.payments.record.checkFailed'));
    payments.checkPaymentAttempt.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await check();
    expect(notice()).toContain(at('contracts.execution.payments.record.checkFailed'));
    expect(stored()).not.toBeNull();
  });

  test('a send whose answer was lost, but which stands in the re-read tab, is said as sent, not "try again" (L2)', async () => {
    const onAnswered = vi.fn().mockResolvedValue(SENT_VIEW);
    show(<SendRequestDialog contractId={CONTRACT} target={MILESTONE} balance="100000.0000" m={m} onAnswered={onAnswered} onClose={vi.fn()} />);
    requests.issueMilestoneRequest.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await press(at('contracts.execution.payments.send.submit'))();
    expect(onAnswered).toHaveBeenCalledWith();
    expect(screen.getByRole('status').textContent).toContain(at('contracts.execution.payments.send.sent'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: at('contracts.execution.payments.send.submit') })).toBeNull();
  });

  test('a send refused as already sent, when the re-read shows it, is said as sent; one that is not there says the refusal', async () => {
    const notSent = { ...VIEW, schedule: [{ ...SENT_VIEW.schedule[0], billed: false }] } as ContractBillingView;
    const first = show(
      <SendRequestDialog contractId={CONTRACT} target={MILESTONE} balance="100000.0000" m={m} onAnswered={vi.fn().mockResolvedValue(SENT_VIEW)} onClose={vi.fn()} />,
    );
    requests.issueMilestoneRequest.mockResolvedValueOnce({ ok: false, error: 'request_exists' });
    await press(at('contracts.execution.payments.send.submit'))();
    expect(screen.getByRole('status').textContent).toContain(at('contracts.execution.payments.send.sent'));
    first.unmount();
    show(<SendRequestDialog contractId={CONTRACT} target={MILESTONE} balance="100000.0000" m={m} onAnswered={vi.fn().mockResolvedValue(notSent)} onClose={vi.fn()} />);
    requests.issueMilestoneRequest.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await press(at('contracts.execution.payments.send.submit'))();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: at('contracts.execution.payments.send.submit') })).toBeTruthy();
  });

  test('a void whose answer was lost, when the re-read shows the request void, says it is voided and only closes (L2)', async () => {
    const voidView = { ...VIEW, requests: [{ id: REQUEST.id, status: 'void' }] } as ContractBillingView;
    const onClose = vi.fn();
    show(<VoidRequestDialog contractId={CONTRACT} request={REQUEST} onAnswered={vi.fn().mockResolvedValue(voidView)} onClose={onClose} />);
    type(voidRequestControlId('reason'), 'Sent twice');
    requests.voidPaymentRequest.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await press(at('contracts.execution.payments.void.submit'))();
    expect(screen.getByRole('status').textContent).toBe(at('contracts.execution.payments.void.done'));
    expect(screen.queryByRole('alert')).toBeNull();
    const closeButton = screen.getAllByRole('button', { name: at('common.close') }).find((button) => button.getAttribute('type') === 'submit');
    await act(async () => {
      fireEvent.click(closeButton!);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(requests.voidPaymentRequest).toHaveBeenCalledTimes(1);
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
