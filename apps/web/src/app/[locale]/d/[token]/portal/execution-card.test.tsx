import { act, fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PortalExecution, PortalExecutionRequest } from '@/lib/engagements/public/execution-types';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { ExecutionCard } from './execution-card';

// PR B4.3: the client's execution card on /d. "I made this payment" asks
// first, naming the request and what is still due; Confirm claims once; a
// claim that landed shows the card the answer carried; a lost answer, or one
// the request moved past, re-reads the card; and every figure is Latin digits,
// left to right, in both locales.

const actions = vi.hoisted(() => ({ claimExecutionRequest: vi.fn(), loadDeliveryExecution: vi.fn() }));
vi.mock('../execution-actions', () => actions);

const ARABIC_INDIC = /[٠-٩۰-۹]/;
const DASH = /[–—]/;

const request = (id: string, fields: Partial<PortalExecutionRequest> = {}): PortalExecutionRequest => ({
  id,
  documentNumber: `PR-2026-000${id}`,
  target: { kind: 'milestone', labelAr: 'الدفعة المقدمة', labelEn: 'Advance' },
  amount: '62000.0000',
  paid: '0.0000',
  outstanding: '62000.0000',
  issuedOn: '2026-11-01',
  dueOn: '2026-11-15',
  void: false,
  claimedAt: null,
  ...fields,
});

const CARD: PortalExecution = {
  contract: { documentNumber: 'C-2026-0007', status: 'signed', titleAr: 'تشطيب فيلا', titleEn: 'Villa fit-out', originalValue: '124000.0000' },
  requests: [
    request('3'),
    request('2', { target: { kind: 'variation', documentNumber: 'VO-2026-0002' }, amount: '12400.0000', paid: '12400.0000', outstanding: '0.0000' }),
    request('1', { target: { kind: 'final_account' }, void: true, outstanding: '0.0000' }),
  ],
  requestsTruncated: false,
  receipts: [{ amount: '12400.0000', receivedOn: '2026-11-03', requestNumber: 'PR-2026-0002' }],
  receiptsTruncated: false,
  paymentDetails: { instapay: 'studio@instapay', bankName: null, bankAccountHolder: null, bankAccountNumber: null, bankIban: null },
};

const CLAIMED: PortalExecution = { ...CARD, requests: [request('3', { claimedAt: '2026-11-05T10:00:00.000Z' }), ...CARD.requests.slice(1)] };

const confirmDialog = () => screen.findByRole('dialog');
async function answerDialog(locale: TestLocale, button: 'confirm' | 'cancel') {
  fireEvent.click(within(await confirmDialog()).getByRole('button', { name: messageAt(locale, `delivery.actions.${button}`) }));
}

const show = (locale: TestLocale, card: PortalExecution = CARD) => renderWithIntl(<ExecutionCard token="tok" initial={card} />, { locale });
const claimButtons = (locale: TestLocale) => screen.queryAllByRole('button', { name: messageAt(locale, 'delivery.execution.claim') });

async function claimAndConfirm(locale: TestLocale) {
  fireEvent.click(claimButtons(locale)[0]);
  await answerDialog(locale, 'confirm');
  await act(async () => {});
}

beforeEach(() => {
  actions.claimExecutionRequest.mockReset();
  actions.loadDeliveryExecution.mockReset();
});

describe.each<TestLocale>(['en', 'ar-EG'])('the execution card (%s)', (locale) => {
  it('shows the contract, every request with what is due, how to pay and the receipts, in Latin digits', () => {
    const { container } = show(locale);
    const text = container.textContent ?? '';
    expect(text).toContain('C-2026-0007');
    expect(text).toContain(messageAt(locale, 'delivery.execution.requests.finalAccount'));
    expect(text).toContain(messageAt(locale, 'delivery.execution.requests.void'));
    expect(text).toContain(messageAt(locale, 'delivery.execution.requests.paid'));
    expect(text).toContain('studio@instapay');
    expect(text).toContain('PR-2026-0002');
    expect(text).toContain('62,000');
    expect(ARABIC_INDIC.test(text)).toBe(false);
    expect(DASH.test(text)).toBe(false);
    // One button: the request still due; none on the paid or the withdrawn one.
    expect(claimButtons(locale)).toHaveLength(1);
  });

  it('asks first, naming the request and what is due; Cancel sends nothing', async () => {
    show(locale);
    fireEvent.click(claimButtons(locale)[0]);
    const dialog = await confirmDialog();
    expect(dialog.textContent).toContain('PR-2026-0003');
    expect(dialog.textContent).toContain('62,000');
    await answerDialog(locale, 'cancel');
    expect(actions.claimExecutionRequest).not.toHaveBeenCalled();
  });

  it('claims once, and shows the card the answer carried, with the studio told', async () => {
    actions.claimExecutionRequest.mockResolvedValue({ ok: true, already: false, execution: CLAIMED });
    show(locale);
    await claimAndConfirm(locale);
    expect(actions.claimExecutionRequest).toHaveBeenCalledWith('tok', '3');
    expect(claimButtons(locale)).toHaveLength(0);
    expect(screen.getByText(messageAt(locale, 'delivery.execution.claimNotified'))).toBeTruthy();
    expect(actions.loadDeliveryExecution).not.toHaveBeenCalled();
  });

  it('a request the studio moved past says so and re-reads the card', async () => {
    actions.claimExecutionRequest.mockResolvedValue({ ok: false, error: 'wrong_state' });
    actions.loadDeliveryExecution.mockResolvedValue({ ok: true, execution: { ...CARD, requests: CARD.requests.slice(1) } });
    show(locale);
    await claimAndConfirm(locale);
    expect(actions.loadDeliveryExecution).toHaveBeenCalledWith('tok');
    expect(claimButtons(locale)).toHaveLength(0);
  });

  it('says the flood ceiling in its own words, and a lost answer as "refresh and check" after a re-read', async () => {
    actions.claimExecutionRequest.mockResolvedValueOnce({ ok: false, error: 'busy' });
    show(locale);
    await claimAndConfirm(locale);
    expect(screen.getByRole('alert').textContent).toBe(messageAt(locale, 'delivery.execution.error.busy'));
    expect(actions.loadDeliveryExecution).not.toHaveBeenCalled();

    actions.claimExecutionRequest.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    actions.loadDeliveryExecution.mockResolvedValue({ ok: false, error: 'too_many' });
    await claimAndConfirm(locale);
    expect(within(screen.getByRole('alert')).getByText(messageAt(locale, 'portal.errors.uncertain'))).toBeTruthy();
    expect(actions.loadDeliveryExecution).toHaveBeenCalledTimes(1);
  });

  it('a pending claim shows when it was sent and offers no second claim', () => {
    show(locale, CLAIMED);
    expect(claimButtons(locale)).toHaveLength(0);
    expect(screen.getByRole('status').textContent).toContain('05/11/2026');
  });
});
