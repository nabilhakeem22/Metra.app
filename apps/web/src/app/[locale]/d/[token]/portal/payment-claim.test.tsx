import { act, fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicDelivery, PublicDeliveryMilestone } from '@/lib/engagements/public/types';
import { answerDialog, confirmDialog } from '@/test/portal-command-card';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { PaymentsCard } from './payments-card';

// AC 25: "I've made this payment" asks first, naming the milestone and the
// amount the claim records; Cancel sends nothing; Confirm claims once, the card
// flips to the waiting state at once and the page re-reads itself.

const actions = vi.hoisted(() => ({ markDeliveryPaymentPaid: vi.fn() }));
vi.mock('../actions', () => actions);
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
  return { milestoneKind, amountRemaining, hasPendingClaim };
}

function renderCard(claim: PublicDelivery['paymentClaim'], locale: TestLocale = 'en') {
  return renderWithIntl(<PaymentsCard token="tok" schedule={MIDWAY} claim={claim} />, { locale });
}

const claimButtons = (locale: TestLocale) =>
  screen.queryAllByRole('button', { name: messageAt(locale, 'delivery.payments.claim') });
const GATE_B = { claimableMilestones: [claimable('gate_b', '28000.0000')] };
const AWAITING = (locale: TestLocale) => messageAt(locale, 'delivery.payments.awaitingConfirmation');

async function claimAndConfirm(locale: TestLocale = 'en') {
  fireEvent.click(claimButtons(locale)[0]);
  await answerDialog(locale, 'confirm');
  await act(async () => {});
}

beforeEach(() => {
  actions.markDeliveryPaymentPaid.mockReset();
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
  });

  it('Cancel sends nothing and keeps the button', async () => {
    renderCard(GATE_B);
    fireEvent.click(claimButtons('en')[0]);
    await answerDialog('en', 'cancel');
    await act(async () => {});
    expect(actions.markDeliveryPaymentPaid).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(claimButtons('en')).toHaveLength(1);
  });

  it('Confirm claims once, flips to waiting without a reload, and refreshes once', async () => {
    actions.markDeliveryPaymentPaid.mockResolvedValue({ ok: true });
    const { container } = renderCard(GATE_B);
    await claimAndConfirm();
    expect(actions.markDeliveryPaymentPaid).toHaveBeenCalledTimes(1);
    expect(actions.markDeliveryPaymentPaid).toHaveBeenCalledWith('tok', 'gate_b');
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(claimButtons('en')).toHaveLength(0);
    expect(container.textContent).toContain(AWAITING('en'));
    // The action did not say the studio heard about it, so the card does not either.
    expect(container.textContent).not.toContain(messageAt('en', 'delivery.payments.claimNotified'));
  });

  it('says the team was notified only when the claim really reached the studio', async () => {
    actions.markDeliveryPaymentPaid.mockResolvedValue({ ok: true, studioNotified: true });
    const { container } = renderCard(GATE_B, 'ar-EG');
    await claimAndConfirm('ar-EG');
    const status = await screen.findByRole('status');
    expect(status.textContent).toContain(messageAt('ar-EG', 'delivery.payments.claimNotified'));
    expect(container.textContent).toContain(AWAITING('ar-EG'));
  });

  it('a failed claim shows a localized error, keeps the button and does not refresh', async () => {
    actions.markDeliveryPaymentPaid.mockResolvedValue({ ok: false, error: 'wrong_state' });
    renderCard(GATE_B);
    await claimAndConfirm();
    expect((await screen.findByRole('alert')).textContent).toBe(
      messageAt('en', 'delivery.payments.error.wrong_state'),
    );
    expect(claimButtons('en')).toHaveLength(1);
    expect(router.refresh).not.toHaveBeenCalled();
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
