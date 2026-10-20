import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ContractBillingView } from '@/lib/execution/billing/view';
import type { PaymentRequestRow } from '@/lib/execution/requests/queries';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { PaymentsTab } from './payments-tab';
import type { BillingMay } from './request-row';
import { useContractBilling } from './use-contract-billing';

// PR A4.3: the Payments tab reads itself through its action when shown (never
// with the page), offers "send request" on what is not billed yet, offers a
// payment only while something is due and no client claim waits, a void only
// while nothing is paid or claimed, and pages the ledger by its cursor.

const reads = vi.hoisted(() => ({ loadContractBilling: vi.fn(), loadContractPayments: vi.fn() }));
vi.mock('@/lib/execution/billing/actions', () => reads);
vi.mock('@/lib/execution/requests/actions', () => ({ issueMilestoneRequest: vi.fn(), issueVariationRequest: vi.fn(), voidPaymentRequest: vi.fn() }));
vi.mock('@/lib/execution/payments/actions', () => ({ recordContractPayment: vi.fn() }));

const request = (id: string, fields: Partial<PaymentRequestRow>): PaymentRequestRow => ({
  id,
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
  finalAccountIssued: false,
  billingBalance: '62000.0000',
  schedule: [
    { id: 'm-1', labelAr: null, labelEn: 'Advance', amount: '62000.0000', billed: true },
    { id: 'm-2', labelAr: null, labelEn: 'Works', amount: '37200.0000', billed: false },
  ],
  variations: [],
  requests: [
    request('1', {}),
    request('2', { paid: '100.0000', outstanding: '61900.0000' }),
    request('3', { hasPendingClaim: true }),
    request('4', { paid: '62000.0000', outstanding: '0.0000' }),
  ],
  moreRequests: false,
  payments: { rows: [{ id: 'p-1', requestNumber: 'PR-2026-0002', amount: '100.0000', receivedOn: '2026-10-20', method: null, reference: null, note: null }], nextCursor: '2026-10-20_p-1' },
};

function Tab({ may }: { may: BillingMay }) {
  return <PaymentsTab billing={useContractBilling('k-1')} may={may} m={(value) => value} />;
}

beforeEach(() => {
  reads.loadContractBilling.mockReset().mockResolvedValue({ ok: true, data: VIEW });
  reads.loadContractPayments.mockReset();
});

describe.each<TestLocale>(['en', 'ar-EG'])('the Payments tab (%s)', (locale) => {
  const at = (key: string) => messageAt(locale, key);
  const rowOf = (id: string) =>
    [...document.querySelectorAll<HTMLElement>('tr[data-request-status]')].find((row) => row.textContent?.includes(`PR-2026-000${id}`))!;
  const buttonsIn = (element: HTMLElement) => [...element.querySelectorAll('button')].map((button) => button.textContent);
  const show = async (may: BillingMay) => {
    await act(async () => {
      renderWithIntl(<Tab may={may} />, { locale });
    });
  };

  test('reads itself once, and offers each control only where it can be taken', async () => {
    await show({ issue: true, record: true });
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
    await show({ issue: true, record: true });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: at('contracts.execution.payments.ledger.more') }));
    });
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
