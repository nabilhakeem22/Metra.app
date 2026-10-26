import { act, fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PortalExecution, PortalExecutionRequest } from '@/lib/engagements/public/execution-types';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { ExecutionPayments } from './execution-payments';

// PR B4.3, moved into the client home's Execution tab (H4.2): the payments.
// "I've made this payment" asks
// first, naming the request and what is still due; Confirm claims once; a
// claim that landed shows the card the answer carried; a lost answer, or one
// the request moved past, re-reads the card, and after a lost answer the read
// decides what the row says (B4 F1); and every figure is Latin digits, left to
// right, in both locales.

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
  earlierClaims: [],
  paymentDetails: { instapay: 'studio@instapay', bankName: null, bankAccountHolder: null, bankAccountNumber: null, bankIban: null },
};

const CLAIMED: PortalExecution = { ...CARD, requests: [request('3', { claimedAt: '2026-11-05T10:00:00.000Z' }), ...CARD.requests.slice(1)] };

const confirmDialog = () => screen.findByRole('dialog');
async function answerDialog(locale: TestLocale, button: 'confirm' | 'cancel') {
  fireEvent.click(within(await confirmDialog()).getByRole('button', { name: messageAt(locale, `delivery.actions.${button}`) }));
}

const onClaimed = vi.fn();
const show = (locale: TestLocale, card: PortalExecution = CARD) =>
  renderWithIntl(<ExecutionPayments token="tok" initial={card} onClaimed={onClaimed} />, { locale });
const claimButtons = (locale: TestLocale) => screen.queryAllByRole('button', { name: messageAt(locale, 'delivery.execution.claim') });

async function claimAndConfirm(locale: TestLocale) {
  fireEvent.click(claimButtons(locale)[0]);
  await answerDialog(locale, 'confirm');
  await act(async () => {});
}

beforeEach(() => {
  actions.claimExecutionRequest.mockReset();
  actions.loadDeliveryExecution.mockReset();
  onClaimed.mockReset();
});

describe.each<TestLocale>(['en', 'ar-EG'])('"how to pay" quotes the buttons it names (%s, B4 F4)', (locale) => {
  it("names the label of the execution card's button and the design fee's, which are the same", () => {
    const label = messageAt(locale, 'delivery.execution.claim');
    expect(messageAt(locale, 'delivery.payments.claim')).toBe(label);
    expect(messageAt(locale, 'delivery.payments.instructions.body.design')).toContain(label);
    expect(messageAt(locale, 'delivery.payments.instructions.body.execution')).toContain(label);
  });
});

describe.each<TestLocale>(['en', 'ar-EG'])('the payments of the Execution tab (%s)', (locale) => {
  it('shows every request with what is due, how to pay and the receipts, in Latin digits', () => {
    const { container } = show(locale);
    const text = container.textContent ?? '';
    expect(screen.getByRole('heading', { name: messageAt(locale, 'delivery.execution.paymentsTitle') })).toBeTruthy();
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
    expect(onClaimed).toHaveBeenCalledTimes(1);
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

  it('a lost answer whose claim landed: the re-read shows it sent, with no warning beside it (B4 F1)', async () => {
    actions.claimExecutionRequest.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    actions.loadDeliveryExecution.mockResolvedValue({ ok: true, execution: CLAIMED });
    show(locale);
    await claimAndConfirm(locale);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(claimButtons(locale)).toHaveLength(0);
    expect(screen.getByRole('status').textContent).toContain(messageAt(locale, 'delivery.execution.claimNotified'));

    actions.claimExecutionRequest.mockResolvedValueOnce({ ok: false, error: 'uncertain' });
    show(locale);
    await claimAndConfirm(locale);
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('a lost answer whose claim did not land: the row says so and keeps its button (B4 F1)', async () => {
    actions.claimExecutionRequest.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    actions.loadDeliveryExecution.mockResolvedValue({ ok: true, execution: CARD });
    show(locale);
    await claimAndConfirm(locale);
    expect(screen.getByRole('alert').textContent).toBe(messageAt(locale, 'delivery.execution.error.not_received'));
    expect(screen.queryByText(messageAt(locale, 'portal.errors.uncertain'))).toBeNull();
    expect(claimButtons(locale)).toHaveLength(1);
  });

  it("keeps a receipt's request number on one line, left to right (B4 F5)", () => {
    show(locale);
    const receipts = screen.getByRole('region', { name: messageAt(locale, 'delivery.execution.receipts.title') });
    const number = [...receipts.querySelectorAll('bdi')].find((node) => node.textContent === 'PR-2026-0002');
    expect(number?.getAttribute('dir')).toBe('ltr');
    expect(number?.className).toContain('whitespace-nowrap');
  });

  it("shows a claim still waiting on an earlier contract, in the client's words (B4 F6)", () => {
    const { container } = show(locale, {
      ...CARD,
      earlierClaims: [{ requestNumber: 'PR-2026-0009', amount: '60000.0000', claimedAt: '2026-11-04T10:00:00.000Z' }],
    });
    const section = screen.getByRole('region', { name: messageAt(locale, 'delivery.execution.earlierClaims.title') });
    expect(section.textContent).toContain('PR-2026-0009');
    expect(section.textContent).toContain('60,000');
    expect(section.textContent).toContain('04/11/2026');
    expect(ARABIC_INDIC.test(container.textContent ?? '')).toBe(false);
    expect(DASH.test(container.textContent ?? '')).toBe(false);
  });

  it('a pending claim shows when it was sent and offers no second claim', () => {
    show(locale, CLAIMED);
    expect(claimButtons(locale)).toHaveLength(0);
    expect(screen.getByRole('status').textContent).toContain('05/11/2026');
  });
});

describe('the two B4 /d defects fixed in the payments (AC18)', () => {
  const DETAILS = {
    instapay: 'noon.studio@instapay',
    bankName: 'البنك الأهلي المصري',
    bankAccountHolder: 'استوديو نون للتصميم',
    bankAccountNumber: '1903 0710 0045 2816',
    bankIban: 'EG380019000500000000263180002',
  };
  const MIXED: PortalExecution = {
    ...CARD,
    requests: [
      request('5', { amount: '307625.4000', outstanding: '307625.4000' }),
      request('4', { amount: '512709.0000', paid: '512709.0000', outstanding: '0.0000' }),
    ],
    receipts: [{ amount: '512709.0000', receivedOn: '2026-10-27', requestNumber: 'PR-2026-0004' }],
    paymentDetails: DETAILS,
  };

  it('sets the bank name and the account holder in the page face, and only the figures in the mono face (ar-EG)', () => {
    show('ar-EG', MIXED);
    const instructions = screen.getByRole('region', { name: messageAt('ar-EG', 'delivery.payments.instructions.title') });
    const valueOf = (text: string) => within(instructions).getByText(text);
    for (const name of [DETAILS.bankName, DETAILS.bankAccountHolder]) {
      expect(valueOf(name).className).not.toContain('font-mono');
      expect(valueOf(name).getAttribute('dir')).toBeNull();
    }
    for (const figure of [DETAILS.instapay, DETAILS.bankAccountNumber, DETAILS.bankIban]) {
      expect(valueOf(figure).className).toContain('font-mono');
      expect(valueOf(figure).getAttribute('dir')).toBe('ltr');
    }
  });

  it.each<TestLocale>(['ar-EG', 'en'])('gives every amount of the list one decimals rule (%s)', (locale) => {
    const { container, unmount } = show(locale, MIXED);
    const text = container.textContent ?? '';
    expect(text).toContain('307,625.40');
    expect(text).toContain('512,709.00');
    expect(text).not.toMatch(/512,709(?![.,\d])/);
    unmount();
    const whole = show(locale, { ...MIXED, requests: [request('5', { amount: '300000.0000', outstanding: '300000.0000' })] });
    expect(whole.container.textContent).toContain('300,000');
    expect(whole.container.textContent).not.toContain('300,000.00');
  });
});
