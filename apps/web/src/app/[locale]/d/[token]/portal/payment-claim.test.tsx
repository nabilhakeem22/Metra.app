import { act, fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicDelivery, PublicDeliveryMilestone } from '@/lib/engagements/public/types';
import { answerDialog, confirmDialog } from '@/test/portal-command-card';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { PaymentsCard } from './payments-card';

// AC 25: "I've made this payment" asks first, naming the milestone and the
// amount the claim records; Cancel sends nothing; with a one-time code (H5,
// OD2 strict: Confirm waits for it), Confirm claims once, the card flips to
// the waiting state at once and the page re-reads itself; a wrong code is said
// in the panel and the claim stays open; no address on file is said plainly.

const actions = vi.hoisted(() => ({ claimDesignPaymentInHome: vi.fn() }));
vi.mock('../actions', () => actions);
const codeActions = vi.hoisted(() => ({ requestClientCode: vi.fn() }));
vi.mock('../code-actions', () => codeActions);
vi.mock('../review-actions', () => ({}));
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

function milestone(
  milestone_kind: string,
  amount_due: string,
  amount_cleared: string,
  status: PublicDeliveryMilestone['status'],
): PublicDeliveryMilestone {
  return { milestone_kind, basis: 'amount', amount_due, amount_cleared, status };
}

/** Deposit paid, gate_b partly paid, the balance still to come. */
const MIDWAY = [
  milestone('deposit', '36000.0000', '36000.0000', 'paid'),
  milestone('gate_b', '48000.0000', '20000.0000', 'partial'),
  milestone('balance', '36000.0000', '0.0000', 'due'),
];

function claimable(milestoneKind: string, amountRemaining: string, hasPendingClaim = false) {
  return { milestoneKind, amountRemaining, hasPendingClaim, claimedAt: null };
}

function renderCard(claim: PublicDelivery['paymentClaim'], locale: TestLocale = 'en', openOn: string | null = null) {
  return renderWithIntl(
    <PaymentsCard
      token="tok"
      schedule={MIDWAY}
      claim={claim}
      details={null}
      receipts={[]}
      receiptsTruncated={false}
      studio={{ name: 'Diwan Studio', whatsappDigits: null, deliveryRef: 'DE-2026-0012' }}
      openOn={openOn}
    />,
    { locale },
  );
}

const claimButtons = (locale: TestLocale) =>
  screen.queryAllByRole('button', { name: messageAt(locale, 'delivery.payments.claim') });
const GATE_B = { claimableMilestones: [claimable('gate_b', '28000.0000')] };
const AWAITING = (locale: TestLocale) => messageAt(locale, 'delivery.payments.awaitingConfirmation');

async function claimAndConfirm(locale: TestLocale = 'en') {
  fireEvent.click(claimButtons(locale)[0]);
  const dialog = await confirmDialog();
  fireEvent.click(within(dialog).getByRole('button', { name: messageAt(locale, 'delivery.code.send') }));
  await act(async () => {});
  fireEvent.change(within(dialog).getByLabelText(messageAt(locale, 'delivery.code.label')), { target: { value: '042917' } });
  await answerDialog(locale, 'confirm');
  await act(async () => {});
}

beforeEach(() => {
  actions.claimDesignPaymentInHome.mockReset();
  codeActions.requestClientCode.mockReset();
  codeActions.requestClientCode.mockResolvedValue({ ok: true, hint: 'c•••@e•••.com', resendAfterSeconds: 60 });
  router.refresh.mockReset();
});

describe('the payment claim', () => {
  it.each(['en', 'ar-EG'] as const)('asks first, naming the milestone and the amount (%s)', async (locale) => {
    renderCard(GATE_B, locale);
    fireEvent.click(claimButtons(locale)[0]);
    const dialog = await confirmDialog();
    expect(within(dialog).getByText(messageAt(locale, 'delivery.payments.confirmTitle'))).toBeTruthy();
    const body = dialog.textContent ?? '';
    expect(body).toContain(messageAt(locale, 'delivery.payments.kind.gate_b'));
    expect(body).toContain(locale === 'en' ? '28,000 EGP' : '28,000 ج.م');
    expect(body).toContain(messageAt(locale, 'delivery.code.introOnFile').replace('{studio}', 'Diwan Studio'));
  });

  it('Cancel sends nothing and keeps the button', async () => {
    renderCard(GATE_B);
    fireEvent.click(claimButtons('en')[0]);
    await answerDialog('en', 'cancel');
    await act(async () => {});
    expect(actions.claimDesignPaymentInHome).not.toHaveBeenCalled();
    expect(codeActions.requestClientCode).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(claimButtons('en')).toHaveLength(1);
  });

  it('Confirm claims once, flips to waiting without a reload, and refreshes once', async () => {
    actions.claimDesignPaymentInHome.mockResolvedValue({ ok: true, already: false, studioNotified: false });
    const { container } = renderCard(GATE_B);
    await claimAndConfirm();
    expect(codeActions.requestClientCode).toHaveBeenCalledWith('tok', { purpose: 'claim_design_payment', target: 'gate_b' });
    expect(actions.claimDesignPaymentInHome).toHaveBeenCalledTimes(1);
    expect(actions.claimDesignPaymentInHome).toHaveBeenCalledWith('tok', { milestoneKind: 'gate_b', code: '042917' });
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(claimButtons('en')).toHaveLength(0);
    expect(container.textContent).toContain(AWAITING('en'));
    // The action did not say the studio heard about it, so the card does not either.
    expect(container.textContent).not.toContain(messageAt('en', 'delivery.payments.claimNotified'));
  });

  it("F1: the email's link opens that instalment's claim on the code box; the typed code claims with no request", async () => {
    actions.claimDesignPaymentInHome.mockResolvedValue({ ok: true, already: false, studioNotified: true });
    renderCard(GATE_B, 'en', 'gate_b');
    const dialog = await confirmDialog();
    expect(dialog.textContent).toContain(messageAt('en', 'delivery.code.typingOnFile').replace('{studio}', 'Diwan Studio'));
    fireEvent.change(within(dialog).getByLabelText(messageAt('en', 'delivery.code.label')), { target: { value: '424242' } });
    await answerDialog('en', 'confirm');
    await act(async () => {});
    expect(codeActions.requestClientCode).not.toHaveBeenCalled();
    expect(actions.claimDesignPaymentInHome).toHaveBeenCalledWith('tok', { milestoneKind: 'gate_b', code: '424242' });
  });

  it('F1: a link to an instalment that cannot be claimed any more opens nothing and says nothing changed', () => {
    renderCard(GATE_B, 'en', 'balance');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText(messageAt('en', 'delivery.payments.changed'))).toBeNull();
  });

  it('weak spot 5: a client learnt to have no address sees no Confirm, only the way to the studio', async () => {
    codeActions.requestClientCode.mockResolvedValue({ ok: false, error: 'no_channel' });
    renderCard(GATE_B);
    fireEvent.click(claimButtons('en')[0]);
    const dialog = await confirmDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: messageAt('en', 'delivery.code.send') }));
    await act(async () => {});
    expect(dialog.textContent).toContain(messageAt('en', 'delivery.code.noChannel').replaceAll('{studio}', 'Diwan Studio'));
    expect(within(dialog).queryByRole('button', { name: messageAt('en', 'delivery.actions.confirm') })).toBeNull();
  });

  it('says the team was notified only when the claim really reached the studio', async () => {
    actions.claimDesignPaymentInHome.mockResolvedValue({ ok: true, already: false, studioNotified: true });
    const { container } = renderCard(GATE_B, 'ar-EG');
    await claimAndConfirm('ar-EG');
    const status = await screen.findByRole('status');
    expect(status.textContent).toContain(messageAt('ar-EG', 'delivery.payments.claimNotified'));
    expect(container.textContent).toContain(AWAITING('ar-EG'));
  });

  it('a failed claim shows a localized error, keeps the button and does not refresh', async () => {
    actions.claimDesignPaymentInHome.mockResolvedValue({ ok: false, error: 'wrong_state', studioNotified: false });
    renderCard(GATE_B);
    await claimAndConfirm();
    expect((await screen.findByRole('alert')).textContent).toBe(
      messageAt('en', 'delivery.payments.error.wrong_state'),
    );
    expect(claimButtons('en')).toHaveLength(1);
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('a wrong code keeps the claim open, said in the panel; nothing is refreshed', async () => {
    actions.claimDesignPaymentInHome.mockResolvedValue({ ok: false, error: 'code_wrong', attemptsLeft: 4, studioNotified: false });
    renderCard(GATE_B);
    await claimAndConfirm();
    const dialog = await confirmDialog();
    expect(within(dialog).getByRole('alert').textContent).toMatch(/\b4\b/);
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('a client with no address on file is told so when the code is asked for, and nothing is claimed', async () => {
    codeActions.requestClientCode.mockResolvedValue({ ok: false, error: 'no_channel' });
    renderCard(GATE_B, 'ar-EG');
    fireEvent.click(claimButtons('ar-EG')[0]);
    const dialog = await confirmDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: messageAt('ar-EG', 'delivery.code.send') }));
    await act(async () => {});
    expect(within(dialog).getByRole('status').textContent).toBe(messageAt('ar-EG', 'delivery.code.noChannel').replaceAll('{studio}', 'Diwan Studio'));
    expect(within(dialog).queryByLabelText(messageAt('ar-EG', 'delivery.code.label'))).toBeNull();
    expect(actions.claimDesignPaymentInHome).not.toHaveBeenCalled();
  });

  it('a pending claim shows the waiting state, and never "notified" from an earlier visit', () => {
    const { container } = renderCard({ claimableMilestones: [claimable('gate_b', '28000.0000', true)] });
    expect(claimButtons('en')).toHaveLength(0);
    expect(container.textContent).toContain(AWAITING('en'));
    expect(container.textContent).not.toContain(messageAt('en', 'delivery.payments.claimNotified'));
  });

  it('offers the claim only for milestones the SDF lists as claimable', () => {
    renderCard({ claimableMilestones: [claimable('balance', '36000.0000')] });
    // gate_b is next but not claimable: no prominent button; balance keeps its row button.
    const buttons = claimButtons('en');
    expect(buttons).toHaveLength(1);
    expect(screen.getAllByRole('listitem')[2].contains(buttons[0])).toBe(true);
  });

  it('shows no claim at all when the snapshot carried no claim object', () => {
    renderCard(null);
    expect(claimButtons('en')).toHaveLength(0);
  });
});
