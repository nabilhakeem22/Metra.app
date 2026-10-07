import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import type { PublicDelivery, PublicDeliveryMilestone } from '@/lib/engagements/public/types';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { PaymentsCard } from './payments-card';

// The server action is replaced, so no server-only stack is loaded.
const actions = vi.hoisted(() => ({ markDeliveryPaymentPaid: vi.fn() }));
vi.mock('../actions', () => actions);

const ARABIC_INDIC = /[٠-٩۰-۹]/;

function milestone(
  milestone_kind: string,
  amount_due: string,
  amount_cleared: string,
  status: PublicDeliveryMilestone['status'],
): PublicDeliveryMilestone {
  return { milestone_kind, basis: 'amount', amount_due, amount_cleared, status };
}

/** The approved mockup's midway schedule: deposit paid, gate_b partly paid. */
const MIDWAY = [
  milestone('deposit', '36000.0000', '36000.0000', 'paid'),
  milestone('gate_b', '48000.0000', '20000.0000', 'partial'),
  milestone('balance', '36000.0000', '0.0000', 'due'),
];

const SETTLED = MIDWAY.map((row) => ({ ...row, amount_cleared: row.amount_due, status: 'paid' as const }));

function claimable(milestoneKind: string, amountRemaining: string, hasPendingClaim = false) {
  return { milestoneKind, amountRemaining, hasPendingClaim };
}

function renderCard(
  schedule: PublicDeliveryMilestone[],
  claim: PublicDelivery['paymentClaim'],
  locale: TestLocale = 'en',
) {
  return renderWithIntl(<PaymentsCard token="tok" schedule={schedule} claim={claim} />, { locale });
}

const claimButtons = (locale: TestLocale) =>
  screen.queryAllByRole('button', { name: messageAt(locale, 'delivery.payments.claim') });

beforeEach(() => {
  actions.markDeliveryPaymentPaid.mockReset();
});

describe('PaymentsCard', () => {
  it('renders nothing without a schedule', () => {
    const { container } = renderCard([], null);
    expect(container.innerHTML).toBe('');
  });

  it('midway: fee total, paid sum, the bar, and the next payment with its claim (en)', () => {
    const { container } = renderCard(MIDWAY, {
      claimableMilestones: [claimable('gate_b', '28000.0000'), claimable('balance', '36000.0000')],
    });
    const text = container.textContent ?? '';
    expect(text).toContain(messageAt('en', 'delivery.payments.title'));
    expect(text).toContain('120,000 EGP');
    expect(text).toContain('56,000 EGP');
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('46');

    const nextLabel = messageAt('en', 'delivery.payments.nextPayment').replace(
      '{milestone}',
      messageAt('en', 'delivery.payments.kind.gate_b'),
    );
    const nextBox = screen.getByText(nextLabel).parentElement as HTMLElement;
    expect(nextBox.textContent).toContain('28,000 EGP');
    expect(within(nextBox).getByRole('button', { name: messageAt('en', 'delivery.payments.claim') })).toBeTruthy();
  });

  it('lists every milestone with its state: paid, partly paid with figures, later', () => {
    renderCard(MIDWAY, null);
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain(messageAt('en', 'delivery.payments.kind.deposit'));
    expect(rows[0].textContent).toContain(messageAt('en', 'delivery.payments.state.paid'));
    expect(rows[0].querySelector('.line-through')?.textContent).toBe('36,000');
    expect(rows[1].textContent).toContain('20,000 EGP');
    expect(rows[1].textContent).toContain('48,000 EGP');
    expect(rows[2].textContent).toContain(messageAt('en', 'delivery.payments.state.later'));
  });

  it('prints whole amounts with no ".00" anywhere on the card', () => {
    const { container } = renderCard(MIDWAY, {
      claimableMilestones: [claimable('gate_b', '28000.0000')],
    });
    expect(container.textContent).not.toContain('.00');
  });

  it('keeps 2 decimals on amounts that are not whole', () => {
    const { container } = renderCard(
      [
        milestone('deposit', '36000.0000', '36000.0000', 'paid'),
        milestone('gate_b', '48000.0000', '20000.5000', 'partial'),
      ],
      null,
    );
    const rows = screen.getAllByRole('listitem');
    expect(rows[1].textContent).toContain('20,000.50 EGP');
    expect(rows[1].textContent).toContain('48,000 EGP');
    // Paid of total and the remaining on the next payment carry the fraction too.
    expect(container.textContent).toContain('56,000.50 EGP');
    expect(container.textContent).toContain('27,999.50 EGP');
  });

  it('reads an untouched next milestone as due', () => {
    renderCard(
      [milestone('deposit', '1000.0000', '1000.0000', 'paid'), milestone('balance', '500.0000', '0', 'due')],
      null,
    );
    const rows = screen.getAllByRole('listitem');
    expect(rows[1].textContent).toContain(messageAt('en', 'delivery.payments.state.due'));
  });

  it('shows the waiting state instead of the button when a claim is pending', () => {
    const { container } = renderCard(MIDWAY, {
      claimableMilestones: [claimable('gate_b', '28000.0000', true)],
    });
    expect(claimButtons('en')).toHaveLength(0);
    expect(container.textContent).toContain(messageAt('en', 'delivery.payments.awaitingConfirmation'));
  });

  it('offers the claim only for milestones the SDF lists as claimable', () => {
    renderCard(MIDWAY, { claimableMilestones: [claimable('balance', '36000.0000')] });
    // gate_b is next but not claimable: no prominent button; balance keeps its row button.
    const buttons = claimButtons('en');
    expect(buttons).toHaveLength(1);
    expect(screen.getAllByRole('listitem')[2].contains(buttons[0])).toBe(true);
  });

  it('shows no claim at all when the snapshot carried no claim object', () => {
    renderCard(MIDWAY, null);
    expect(claimButtons('en')).toHaveLength(0);
  });

  it('claims the milestone and flips it to waiting', async () => {
    actions.markDeliveryPaymentPaid.mockResolvedValue({ ok: true });
    const { container } = renderCard(MIDWAY, {
      claimableMilestones: [claimable('gate_b', '28000.0000')],
    });
    fireEvent.click(claimButtons('en')[0]);
    await screen.findByRole('status');
    expect(actions.markDeliveryPaymentPaid).toHaveBeenCalledWith('tok', 'gate_b');
    expect(claimButtons('en')).toHaveLength(0);
    expect(container.textContent).toContain(messageAt('en', 'delivery.payments.awaitingConfirmation'));
    // The action did not say the studio heard about it, so the card does not either.
    expect(container.textContent).not.toContain(messageAt('en', 'delivery.payments.claimNotified'));
  });

  it('says the team was notified only when the claim really reached the studio', async () => {
    actions.markDeliveryPaymentPaid.mockResolvedValue({ ok: true, studioNotified: true });
    const { container } = renderCard(MIDWAY, {
      claimableMilestones: [claimable('gate_b', '28000.0000')],
    }, 'ar-EG');
    fireEvent.click(claimButtons('ar-EG')[0]);
    const status = await screen.findByRole('status');
    expect(status.textContent).toContain(messageAt('ar-EG', 'delivery.payments.claimNotified'));
    expect(container.textContent).toContain(messageAt('ar-EG', 'delivery.payments.awaitingConfirmation'));
  });

  it('an already-pending claim from an earlier visit never says notified', () => {
    const { container } = renderCard(MIDWAY, {
      claimableMilestones: [claimable('gate_b', '28000.0000', true)],
    });
    expect(container.textContent).toContain(messageAt('en', 'delivery.payments.awaitingConfirmation'));
    expect(container.textContent).not.toContain(messageAt('en', 'delivery.payments.claimNotified'));
  });

  it('shows a localized error on a failed claim and keeps the button', async () => {
    actions.markDeliveryPaymentPaid.mockResolvedValue({ ok: false, error: 'wrong_state' });
    renderCard(MIDWAY, { claimableMilestones: [claimable('gate_b', '28000.0000')] });
    fireEvent.click(claimButtons('en')[0]);
    expect((await screen.findByRole('alert')).textContent).toBe(
      messageAt('en', 'delivery.payments.error.wrong_state'),
    );
    expect(claimButtons('en')).toHaveLength(1);
  });

  it('all settled (ar-EG): the thank-you, a full bar, no claim, Latin digits', () => {
    const { container } = renderCard(SETTLED, { claimableMilestones: [] }, 'ar-EG');
    const text = container.textContent ?? '';
    expect(text).toContain(messageAt('ar-EG', 'delivery.payments.settledTitle'));
    expect(text).toContain(messageAt('ar-EG', 'delivery.payments.settledBody'));
    expect(text).toContain('120,000 ج.م');
    expect(ARABIC_INDIC.test(text)).toBe(false);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
    expect(claimButtons('ar-EG')).toHaveLength(0);
    expect(container.querySelectorAll('.line-through')).toHaveLength(3);
  });

  it('midway in Arabic: Arabic labels and the partly-paid line', () => {
    const { container } = renderCard(MIDWAY, {
      claimableMilestones: [claimable('gate_b', '28000.0000')],
    }, 'ar-EG');
    const text = container.textContent ?? '';
    expect(text).toContain(messageAt('ar-EG', 'delivery.payments.kind.gate_b'));
    expect(text).toContain('28,000 ج.م');
    const partialLead = messageAt('ar-EG', 'delivery.payments.state.partial').split('{')[0].trim();
    expect(screen.getAllByRole('listitem')[1].textContent).toContain(partialLead);
    expect(screen.getAllByRole('listitem')[1].textContent).toContain('48,000 ج.م');
    expect(claimButtons('ar-EG')).toHaveLength(1);
    expect(container.innerHTML).not.toMatch(/emerald|amber/);
  });
});
