import { describe, expect, it, vi } from 'vitest';
import type { DeliveryStatus } from '@/lib/engagements/delivery-status';
import { deliveryCounts } from './delivery-due-work';

vi.mock('server-only', () => ({}));

const of = (...statuses: DeliveryStatus[]) => statuses.map((status) => ({ status }));

describe('deliveryCounts', () => {
  it('counts the studio moves (a payment to confirm included), the waiting and the stalled', () => {
    expect(
      deliveryCounts(
        of(
          { kind: 'yourMove' },
          { kind: 'confirmPayment' },
          { kind: 'yourMove' },
          { kind: 'waitingClient', days: 2 },
          { kind: 'stalled', days: 9 },
          { kind: 'stalled', days: 30 },
          { kind: 'delivered' },
          { kind: 'abandoned' },
        ),
      ),
    ).toEqual({ yourMove: 3, waitingOnClient: 1, stalled: 2 });
  });

  it('nothing in flight is all zeros', () => {
    expect(deliveryCounts([])).toEqual({ yourMove: 0, waitingOnClient: 0, stalled: 0 });
  });
});
