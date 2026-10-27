import { act, fireEvent, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PortalExecution, PortalExecutionRequest } from '@/lib/engagements/public/execution-types';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { ExecutionPayments } from './execution-payments';

// PR B4.3, moved into the client home's Execution tab (H4.2): the payments.
// "I've made this payment" opens the claim, naming the request and what is
// still due, with the one-time code panel (H5, OD2 strict): Confirm waits for
// a sent code and six typed digits, then claims once with it; a claim that
// landed shows on its row at once and refreshes the page; a wrong or spent
// code is said in the panel and the claim stays open; a request the studio
// moved past refreshes the page; after a lost answer a read decides what the
// row says (B4 F1); and every figure is Latin digits, left to right, in both
// locales.

const actions = vi.hoisted(() => ({ claimRequestInHome: vi.fn(), loadDeliveryExecution: vi.fn() }));
vi.mock('../execution-actions', () => actions);
const codeActions = vi.hoisted(() => ({ requestClientCode: vi.fn() }));
vi.mock('../code-actions', () => codeActions);

const ARABIC_INDIC = /[٠-٩۰-۹]/;
const DASH = /[–—]/;
const HINT = 'c•••@e•••.com';

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

const onChanged = vi.fn();
const STUDIO = { name: 'Diwan Studio', whatsappDigits: '201001234567', deliveryRef: 'DE-2026-0012' };
const show = (locale: TestLocale, card: PortalExecution = CARD, channel: { hint: string } | null = { hint: HINT }, openOn: string | null = null) =>
  renderWithIntl(<ExecutionPayments token="tok" initial={card} onChanged={onChanged} channel={channel} studio={STUDIO} openOn={openOn} />, {
    locale,
  });
const claimButtons = (locale: TestLocale) => screen.queryAllByRole('button', { name: messageAt(locale, 'delivery.execution.claim') });
const confirmButton = async (locale: TestLocale) =>
  within(await confirmDialog()).getByRole('button', { name: messageAt(locale, 'delivery.actions.confirm') }) as HTMLButtonElement;
const codeBox = (dialog: HTMLElement, locale: TestLocale) =>
  within(dialog).getByLabelText(messageAt(locale, 'delivery.code.label')) as HTMLInputElement;

/** Open the first claim, ask for a code, and type `code`. */
async function openWithCode(locale: TestLocale, code = '042917') {
  fireEvent.click(claimButtons(locale)[0]);
  const dialog = await confirmDialog();
  fireEvent.click(within(dialog).getByRole('button', { name: messageAt(locale, 'delivery.code.send') }));
  await act(async () => {});
  fireEvent.change(codeBox(dialog, locale), { target: { value: code } });
}

async function claimAndConfirm(locale: TestLocale, code?: string) {
  await openWithCode(locale, code);
  await answerDialog(locale, 'confirm');
  await act(async () => {});
}

beforeEach(() => {
  actions.claimRequestInHome.mockReset();
  actions.loadDeliveryExecution.mockReset();
  codeActions.requestClientCode.mockReset();
  codeActions.requestClientCode.mockResolvedValue({ ok: true, hint: HINT, resendAfterSeconds: 60 });
  onChanged.mockReset();
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

  it('asks first, naming the request and what is due; Confirm waits for a code; Cancel sends nothing', async () => {
    show(locale);
    fireEvent.click(claimButtons(locale)[0]);
    const dialog = await confirmDialog();
    expect(dialog.textContent).toContain('PR-2026-0003');
    expect(dialog.textContent).toContain('62,000');
    expect(dialog.textContent).toContain(HINT);
    expect((await confirmButton(locale)).disabled).toBe(true);
    await answerDialog(locale, 'cancel');
    expect(codeActions.requestClientCode).not.toHaveBeenCalled();
    expect(actions.claimRequestInHome).not.toHaveBeenCalled();
  });

  it('asks for a code for this request, then claims once with it; the row shows it sent, the studio told', async () => {
    actions.claimRequestInHome.mockResolvedValue({ ok: true, already: false });
    show(locale);
    await openWithCode(locale, '٠٤٢٩١٧');
    expect(codeActions.requestClientCode).toHaveBeenCalledWith('tok', { purpose: 'claim_request', target: '3' });
    expect(codeBox(await confirmDialog(), locale).value).toBe('042917');
    expect((await confirmButton(locale)).disabled).toBe(false);
    await answerDialog(locale, 'confirm');
    await act(async () => {});
    expect(actions.claimRequestInHome).toHaveBeenCalledWith('tok', { requestId: '3', code: '042917' });
    expect(claimButtons(locale)).toHaveLength(0);
    expect(screen.getByText(messageAt(locale, 'delivery.execution.claimNotified'))).toBeTruthy();
    expect(actions.loadDeliveryExecution).not.toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('a wrong code says the tries left and keeps the claim open; a locked one asks for a new code', async () => {
    actions.claimRequestInHome.mockResolvedValueOnce({ ok: false, error: 'code_wrong', attemptsLeft: 3 });
    show(locale);
    await claimAndConfirm(locale);
    const dialog = await confirmDialog();
    const wrong = within(dialog).getByRole('alert').textContent ?? '';
    expect(wrong).toMatch(/\b3\b/);
    expect(wrong).not.toMatch(ARABIC_INDIC);
    expect(codeBox(dialog, locale).value).toBe('');

    actions.claimRequestInHome.mockResolvedValueOnce({ ok: false, error: 'code_locked' });
    fireEvent.change(codeBox(dialog, locale), { target: { value: '111111' } });
    await answerDialog(locale, 'confirm');
    await act(async () => {});
    expect(within(dialog).getByRole('alert').textContent).toBe(messageAt(locale, 'delivery.code.error.code_locked'));
    expect(within(dialog).queryByLabelText(messageAt(locale, 'delivery.code.label'))).toBeNull();
    expect(within(dialog).getByRole('button', { name: messageAt(locale, 'delivery.code.send') })).toBeTruthy();
  });

  it('busy keeps the claim open and the typed code, said as "try again in a moment"', async () => {
    actions.claimRequestInHome.mockResolvedValueOnce({ ok: false, error: 'busy' });
    show(locale);
    await claimAndConfirm(locale);
    const dialog = await confirmDialog();
    expect(within(dialog).getByRole('alert').textContent).toBe(messageAt(locale, 'delivery.code.error.busy'));
    expect(codeBox(dialog, locale).value).toBe('042917');
  });

  it('a request the studio moved past closes the claim, says so and refreshes the page', async () => {
    actions.claimRequestInHome.mockResolvedValue({ ok: false, error: 'wrong_state' });
    show(locale);
    await claimAndConfirm(locale);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('alert').textContent).toBe(messageAt(locale, 'delivery.execution.error.wrong_state'));
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('a lost answer is "refresh and check" after a read that failed too', async () => {
    actions.claimRequestInHome.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    actions.loadDeliveryExecution.mockResolvedValue({ ok: false, error: 'too_many' });
    show(locale);
    await claimAndConfirm(locale);
    expect(within(screen.getByRole('alert')).getByText(messageAt(locale, 'portal.errors.uncertain'))).toBeTruthy();
    expect(actions.loadDeliveryExecution).toHaveBeenCalledTimes(1);
  });

  it('a lost answer whose claim landed: the re-read shows it sent, with no warning beside it (B4 F1)', async () => {
    actions.claimRequestInHome.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    actions.loadDeliveryExecution.mockResolvedValue({ ok: true, execution: CLAIMED });
    show(locale);
    await claimAndConfirm(locale);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(claimButtons(locale)).toHaveLength(0);
    expect(screen.getByRole('status').textContent).toContain(messageAt(locale, 'delivery.execution.claimNotified'));
  });

  it('a lost answer whose claim did not land: the row says so and keeps its button (B4 F1)', async () => {
    actions.claimRequestInHome.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    actions.loadDeliveryExecution.mockResolvedValue({ ok: true, execution: CARD });
    show(locale);
    await claimAndConfirm(locale);
    expect(screen.getByRole('alert').textContent).toBe(messageAt(locale, 'delivery.execution.error.not_received'));
    expect(screen.queryByText(messageAt(locale, 'portal.errors.uncertain'))).toBeNull();
    expect(claimButtons(locale)).toHaveLength(1);
  });

  it("with no email on file the claim says so plainly, offers the studio's WhatsApp, shows no Confirm, and sends nothing", async () => {
    show(locale, CARD, null);
    fireEvent.click(claimButtons(locale)[0]);
    const dialog = await confirmDialog();
    expect(dialog.textContent).toContain(messageAt(locale, 'delivery.code.noChannel.payment').replaceAll('{studio}', 'Diwan Studio'));
    expect(within(dialog).queryByRole('button', { name: messageAt(locale, 'delivery.code.send') })).toBeNull();
    expect(within(dialog).getByRole('link').getAttribute('href')).toMatch(/^https:\/\/wa\.me\/201001234567\?text=/);
    expect(within(dialog).queryByRole('button', { name: messageAt(locale, 'delivery.actions.confirm') })).toBeNull();
    expect(within(dialog).getByRole('button', { name: messageAt(locale, 'delivery.actions.cancel') })).toBeTruthy();
    expect(codeActions.requestClientCode).not.toHaveBeenCalled();
  });

  it('F1: "I already have a code" opens the box with no request: the typed code claims by the request alone', async () => {
    actions.claimRequestInHome.mockResolvedValue({ ok: true, already: false });
    show(locale);
    fireEvent.click(claimButtons(locale)[0]);
    const dialog = await confirmDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: messageAt(locale, 'delivery.code.haveCode') }));
    expect(dialog.textContent).toContain(HINT);
    fireEvent.change(codeBox(dialog, locale), { target: { value: '424242' } });
    await answerDialog(locale, 'confirm');
    await act(async () => {});
    expect(codeActions.requestClientCode).not.toHaveBeenCalled();
    expect(actions.claimRequestInHome).toHaveBeenCalledWith('tok', { requestId: '3', code: '424242' });
  });

  it("F1: the email's link opens that request's claim at once, on the code box; a request no longer claimable opens nothing", async () => {
    const { unmount } = show(locale, CARD, { hint: HINT }, '3');
    const dialog = await confirmDialog();
    expect(dialog.textContent).toContain('PR-2026-0003');
    expect(codeBox(dialog, locale)).toBeTruthy();
    expect(codeActions.requestClientCode).not.toHaveBeenCalled();
    unmount();
    show(locale, CARD, { hint: HINT }, '2');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it("weak spot 2: the link's brake on the claim keeps it open, the code kept, Confirm held until the wait is over", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      actions.claimRequestInHome.mockResolvedValueOnce({ ok: false, error: 'too_many', retryAfterSeconds: 60, limit: 'link_minute' });
      show(locale);
      await claimAndConfirm(locale);
      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByRole('alert').textContent).toContain(
        messageAt(locale, 'delivery.code.tooMany.link').slice(0, messageAt(locale, 'delivery.code.tooMany.link').indexOf('{wait}')),
      );
      expect(codeBox(dialog, locale).value).toBe('042917');
      expect((within(dialog).getByRole('button', { name: messageAt(locale, 'delivery.actions.confirm') }) as HTMLButtonElement).disabled).toBe(true);
      await act(async () => {
        vi.advanceTimersByTime(61_000);
      });
      expect(within(dialog).queryByRole('alert')).toBeNull();
      expect((within(dialog).getByRole('button', { name: messageAt(locale, 'delivery.actions.confirm') }) as HTMLButtonElement).disabled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('F2: after send_failed the 60 s countdown runs and Send waits for it; F3: a limit\'s notice goes when its wait ends', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      codeActions.requestClientCode.mockResolvedValueOnce({ ok: false, error: 'send_failed', resendAfterSeconds: 60 });
      show(locale);
      fireEvent.click(claimButtons(locale)[0]);
      const dialog = screen.getByRole('dialog');
      const send = () => within(dialog).getByRole('button', { name: messageAt(locale, 'delivery.code.send') }) as HTMLButtonElement;
      fireEvent.click(send());
      await act(async () => {});
      expect(within(dialog).getByRole('alert').textContent).toBe(messageAt(locale, 'delivery.code.error.send_failed').replace('{studio}', 'Diwan Studio'));
      expect(dialog.querySelector('[data-code-wait]')?.textContent).toContain('1:00');
      expect(send().disabled).toBe(true);
      await act(async () => {
        vi.advanceTimersByTime(61_000);
      });
      expect(send().disabled).toBe(false);

      codeActions.requestClientCode.mockResolvedValueOnce({ ok: false, error: 'too_many', retryAfterSeconds: 90, limit: 'studio_day' });
      fireEvent.click(send());
      await act(async () => {});
      expect(within(dialog).getByRole('alert').textContent).toContain('Diwan Studio');
      await act(async () => {
        vi.advanceTimersByTime(91_000);
      });
      expect(within(dialog).queryByRole('alert')).toBeNull();
      expect(send().disabled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('follows a new read the page hands down', () => {
    function Page() {
      const [card, setCard] = useState(CARD);
      return (
        <>
          <button onClick={() => setCard(CLAIMED)}>refresh</button>
          <ExecutionPayments token="tok" initial={card} onChanged={onChanged} channel={{ hint: HINT }} studio={STUDIO} openOn={null} />
        </>
      );
    }
    renderWithIntl(<Page />, { locale });
    expect(claimButtons(locale)).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'refresh' }));
    expect(claimButtons(locale)).toHaveLength(0);
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
