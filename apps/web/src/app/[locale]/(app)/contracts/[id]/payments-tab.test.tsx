import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ContractBillingView } from '@/lib/execution/billing/view';
import type { PaymentRequestRow } from '@/lib/execution/requests/queries';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { PaymentsTab } from './payments-tab';
import type { BillingMay } from './request-row';

// PR A4.3 and its fix round: the Payments tab reads itself through its action
// EVERY time it is shown (never with the page, never a view from before, F3),
// offers "send request" on what is not billed yet, a payment only while
// something is due and no client claim waits, a void only while nothing is
// paid or claimed; shows the view a write answers with, reads itself after a
// write that failed, keeps the open dialog through a re-read, says the note of
// each request (F10), never says "left to bill" below zero (F11), and pages
// the ledger by its cursor.

const reads = vi.hoisted(() => ({ loadContractBilling: vi.fn(), loadContractPayments: vi.fn() }));
vi.mock('@/lib/execution/billing/actions', () => reads);
const writes = vi.hoisted(() => ({ issueMilestoneRequest: vi.fn(), issueVariationRequest: vi.fn(), voidPaymentRequest: vi.fn() }));
vi.mock('@/lib/execution/requests/actions', () => writes);
const payments = vi.hoisted(() => ({ recordContractPayment: vi.fn(), checkPaymentAttempt: vi.fn() }));
vi.mock('@/lib/execution/payments/actions', () => payments);

const request = (id: string, fields: Partial<PaymentRequestRow>): PaymentRequestRow => ({
  id: `r0000000-0000-4000-8000-00000000000${id}`,
  documentNumber: `PR-2026-000${id}`,
  kind: 'milestone',
  status: 'issued',
  target: { labelAr: null, labelEn: 'Advance' },
  amount: '62000.0000',
  taxAmount: '7000.0000',
  paid: '0',
  outstanding: '62000.0000',
  issuedOn: '2026-10-20',
  dueOn: null,
  note: null,
  hasPendingClaim: false,
  ...fields,
});

const VIEW: ContractBillingView = {
  contractId: 'k-1',
  status: 'signed',
  issuedOn: '2020-01-01',
  finalAccountIssued: false,
  billingBalance: '62000.0000',
  schedule: [
    { id: 'm-1', labelAr: null, labelEn: 'Advance', amount: '62000.0000', billed: true },
    { id: 'm-2', labelAr: null, labelEn: 'Works', amount: '37200.0000', billed: false },
  ],
  variations: [],
  requests: [
    request('1', { note: 'Wire to the NBE account' }),
    request('2', { paid: '100.0000', outstanding: '61900.0000' }),
    request('3', { hasPendingClaim: true }),
    request('4', { paid: '62000.0000', outstanding: '0.0000' }),
  ],
  moreRequests: false,
  payments: { rows: [{ id: 'p-1', requestNumber: 'PR-2026-0002', amount: '100.0000', receivedOn: '2026-10-20', method: null, reference: null, note: null }], nextCursor: '2026-10-20_p-1' },
};

/** Request 1 once 5,000 of it is paid. */
const PAID_VIEW: ContractBillingView = {
  ...VIEW,
  requests: [request('1', { paid: '5000.0000', outstanding: '57000.0000' }), ...VIEW.requests.slice(1)],
};

beforeEach(() => {
  reads.loadContractBilling.mockReset().mockResolvedValue({ ok: true, data: VIEW });
  reads.loadContractPayments.mockReset();
  for (const action of [...Object.values(writes), ...Object.values(payments)]) action.mockReset();
  sessionStorage.clear();
});

describe.each<TestLocale>(['en', 'ar-EG'])('the Payments tab (%s)', (locale) => {
  const at = (key: string) => messageAt(locale, key);
  const rowOf = (id: string) =>
    [...document.querySelectorAll<HTMLElement>('tr[data-request-status]')].find((row) => row.textContent?.includes(`PR-2026-000${id}`))!;
  const buttonsIn = (element: HTMLElement) => [...element.querySelectorAll('button')].map((button) => button.textContent);
  const show = async (may: BillingMay = { issue: true, record: true }) => {
    let rendered!: ReturnType<typeof renderWithIntl>;
    await act(async () => {
      rendered = renderWithIntl(<PaymentsTab contractId="k-1" may={may} m={(value) => value} />, { locale });
    });
    return rendered;
  };
  const click = async (element: HTMLElement) => {
    await act(async () => {
      fireEvent.click(element);
    });
  };
  const recordOn = (id: string) => click([...rowOf(id).querySelectorAll('button')].find((b) => b.textContent === at('contracts.execution.payments.record.open'))!);
  const saveRecord = () => click(screen.getByRole('button', { name: at('contracts.execution.payments.record.submit') }));

  test('reads itself once when shown, and offers each control only where it can be taken', async () => {
    await show();
    expect(reads.loadContractBilling).toHaveBeenCalledTimes(1);
    expect(reads.loadContractBilling).toHaveBeenCalledWith({ contractId: 'k-1' });
    const record = at('contracts.execution.payments.record.open');
    const voidIt = at('contracts.execution.payments.void.open');
    expect(buttonsIn(rowOf('1'))).toEqual([record, voidIt]);
    expect(buttonsIn(rowOf('2'))).toEqual([record]);
    expect(buttonsIn(rowOf('3'))).toEqual([]);
    expect(buttonsIn(rowOf('4'))).toEqual([]);
    expect(screen.getByText(at('contracts.execution.payments.requests.claimPending'))).toBeTruthy();
    expect(screen.getAllByRole('button', { name: at('contracts.execution.payments.send.open') })).toHaveLength(1);
  });

  test('shown again (a tab switch), it reads itself again and shows what the read says, never what it showed before', async () => {
    const first = await show();
    first.unmount();
    reads.loadContractBilling.mockResolvedValue({ ok: true, data: { ...PAID_VIEW, status: 'terminated' } });
    await show();
    expect(reads.loadContractBilling).toHaveBeenCalledTimes(2);
    expect(rowOf('1').textContent).toContain('5000.0000');
    expect(screen.getByText(at('contracts.execution.payments.closed.terminated'))).toBeTruthy();
    expect(screen.queryByRole('button', { name: at('contracts.execution.payments.send.open') })).toBeNull();
  });

  test('a write that worked shows the view it answered with, and reads nothing more', async () => {
    await show();
    await recordOn('1');
    payments.recordContractPayment.mockResolvedValue({ ok: true, data: 'p-9', already: false, view: PAID_VIEW });
    await saveRecord();
    expect(payments.recordContractPayment.mock.calls[0][1]).toEqual({ contractId: 'k-1' });
    expect(reads.loadContractBilling).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(rowOf('1').textContent).toContain('57000.0000');
  });

  test('a write whose answer never came reads the tab again, and the dialog stays open on it with what is due now', async () => {
    await show();
    await recordOn('1');
    reads.loadContractBilling.mockResolvedValue({ ok: true, data: PAID_VIEW });
    payments.recordContractPayment.mockRejectedValue(new TypeError('Failed to fetch'));
    await saveRecord();
    expect(reads.loadContractBilling).toHaveBeenCalledTimes(2);
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('57000.0000');
    expect(screen.getByRole('button', { name: at('contracts.execution.payments.record.submit') })).toBeTruthy();
  });

  test('"already recorded" closes the dialog and says so on the tab', async () => {
    await show();
    await recordOn('1');
    payments.recordContractPayment.mockResolvedValue({ ok: true, data: 'p-1', already: true, view: PAID_VIEW });
    await saveRecord();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe(at('contracts.execution.payments.record.already'));
  });

  test('a send whose re-read bills the row keeps its dialog open on the server\'s warning', async () => {
    await show();
    await click(screen.getByRole('button', { name: at('contracts.execution.payments.send.open') }));
    const billed = { ...VIEW, schedule: VIEW.schedule.map((row) => ({ ...row, billed: true })) };
    writes.issueMilestoneRequest.mockResolvedValue({ ok: true, data: 'r-9', balanceWarning: { balance: '100.0000' }, view: billed });
    await click(screen.getByRole('button', { name: at('contracts.execution.payments.send.submit') }));
    expect(screen.getByRole('dialog').textContent).toContain(at('contracts.execution.payments.send.sent'));
    expect(screen.queryByRole('button', { name: at('contracts.execution.payments.send.open') })).toBeNull();
  });

  test('each request says the note it was sent with', async () => {
    await show();
    expect(rowOf('1').querySelector('[data-request-note]')?.textContent).toBe('Wire to the NBE account');
    expect(rowOf('2').querySelector('[data-request-note]')).toBeNull();
  });

  test('"left to bill" is never below zero', async () => {
    reads.loadContractBilling.mockResolvedValue({ ok: true, data: { ...VIEW, billingBalance: '-30752.0000' } });
    await show();
    expect(screen.queryByText('-30752.0000')).toBeNull();
    expect(screen.getByText(at('contracts.execution.payments.leftToBill')).nextElementSibling?.textContent).toBe('0.0000');
  });

  test('a role that only reads sees the money and no control; an unsigned contract says why nothing is sent', async () => {
    reads.loadContractBilling.mockResolvedValue({ ok: true, data: { ...VIEW, status: 'issued' } });
    await show({ issue: false, record: false });
    for (const id of ['1', '2', '3', '4']) expect(buttonsIn(rowOf(id))).toEqual([]);
    expect(screen.queryByRole('button', { name: at('contracts.execution.payments.send.open') })).toBeNull();
    expect(screen.getByText(at('contracts.execution.payments.closed.notSigned'))).toBeTruthy();
  });

  test('"show more" asks for the next page by its cursor and adds it under the first', async () => {
    reads.loadContractPayments.mockResolvedValue({
      ok: true,
      data: { rows: [{ ...VIEW.payments.rows[0], id: 'p-2', amount: '7.0000' }], nextCursor: null },
    });
    await show();
    await click(screen.getByRole('button', { name: at('contracts.execution.payments.ledger.more') }));
    expect(reads.loadContractPayments).toHaveBeenCalledWith({ contractId: 'k-1', cursor: '2026-10-20_p-1' });
    expect(screen.getByText('7.0000')).toBeTruthy();
    expect(screen.queryByRole('button', { name: at('contracts.execution.payments.ledger.more') })).toBeNull();
  });

  test('a refused read is said above the tab', async () => {
    reads.loadContractBilling.mockResolvedValue({ ok: false, error: 'forbidden' });
    await show({ issue: false, record: false });
    expect(screen.getByRole('alert').textContent).toBe(at('errors.forbidden'));
  });
});
