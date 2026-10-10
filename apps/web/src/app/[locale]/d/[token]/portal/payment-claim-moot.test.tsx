import { act, fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { PublicDelivery, PublicDeliveryMilestone } from '@/lib/engagements/public/types';
import { messageAt, renderWithIntl } from '@/test/render-with-intl';
import { PaymentsCard } from './payments-card';

// F11: a refresh that lands while "Did you make this payment?" is open and no
// longer lists the milestone as claimable closes the dialog for good, sends
// nothing, and says why in one line. It never reopens by itself.

const actions = vi.hoisted(() => ({ markDeliveryPaymentPaid: vi.fn() }));
vi.mock('../actions', () => actions);
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const SCHEDULE: PublicDeliveryMilestone[] = [
  { milestone_kind: 'deposit', basis: 'amount', amount_due: '30000.0000', amount_cleared: '0.0000', status: 'due' },
];
const CLAIMABLE: PublicDelivery['paymentClaim'] = {
  claimableMilestones: [{ milestoneKind: 'deposit', amountRemaining: '30000.0000', hasPendingClaim: false, claimedAt: null }],
};
const SETTLED: PublicDelivery['paymentClaim'] = { claimableMilestones: [] };

function Page() {
  const [claim, setClaim] = useState(CLAIMABLE);
  return (
    <>
      <button type="button" hidden onClick={() => setClaim(SETTLED)}>
        studio recorded it
      </button>
      <button type="button" hidden onClick={() => setClaim(CLAIMABLE)}>
        claimable again
      </button>
      <PaymentsCard token="tok" schedule={SCHEDULE} claim={claim} details={null} timeline={[]} />
    </>
  );
}

describe('a payment confirmation the server made moot', () => {
  it('closes, sends nothing, says why, and does not reopen', async () => {
    renderWithIntl(<Page />, { locale: 'ar-EG' });
    fireEvent.click(screen.getByRole('button', { name: messageAt('ar-EG', 'delivery.payments.claim') }));
    expect(await screen.findByRole('dialog')).toBeTruthy();

    fireEvent.click(screen.getByText('studio recorded it'));
    await act(async () => {});
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe(messageAt('ar-EG', 'delivery.payments.changed'));

    fireEvent.click(screen.getByText('claimable again'));
    await act(async () => {});
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(actions.markDeliveryPaymentPaid).not.toHaveBeenCalled();
  });
});
