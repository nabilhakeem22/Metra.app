import { describe, expect, test } from 'vitest';
import type { WhoseMove } from '@/lib/engagements/whose-move';
import { orderForTriage } from './triage-order';

const row = (id: string, whoseMove: WhoseMove, updatedAt: string) => ({ id, whoseMove, updatedAt });

describe('orderForTriage', () => {
  test('studio-actionable rows first, then waiting on the client; oldest first in each group', () => {
    const ordered = orderForTriage([
      row('client-old', 'client', '2026-09-01T00:00:00.000Z'),
      row('studio-new', 'studio', '2026-10-06T00:00:00.000Z'),
      row('client-new', 'client', '2026-10-05T00:00:00.000Z'),
      row('pay-mid', 'confirmPayment', '2026-10-01T00:00:00.000Z'),
      row('studio-old', 'studio', '2026-09-20T00:00:00.000Z'),
    ]);
    expect(ordered.map((r) => r.id)).toEqual([
      'studio-old',
      'pay-mid',
      'studio-new',
      'client-old',
      'client-new',
    ]);
  });

  test('a delivery the client just answered (fresh updated_at) is still first when it is the studio move', () => {
    const ordered = orderForTriage([
      row('waiting-for-ages', 'client', '2026-08-01T00:00:00.000Z'),
      row('client-just-acted', 'studio', '2026-10-07T09:00:00.000Z'),
    ]);
    expect(ordered[0].id).toBe('client-just-acted');
  });

  test('does not reorder its input in place', () => {
    const input = [row('b', 'client', '2026-10-01T00:00:00.000Z'), row('a', 'studio', '2026-10-02T00:00:00.000Z')];
    orderForTriage(input);
    expect(input.map((r) => r.id)).toEqual(['b', 'a']);
  });
});
