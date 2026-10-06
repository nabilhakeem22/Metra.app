// The dashboard deliveries panel's ORDER. PURE and client-safe: what needs the
// studio comes first, then what waits on the client, oldest first in each group.
import type { WhoseMove } from '@/lib/engagements/whose-move';

/** Studio-actionable (your move, a payment to confirm) before waiting on the client. */
const GROUP: Record<WhoseMove, number> = {
  studio: 0,
  confirmPayment: 0,
  client: 1,
  closed: 2,
};

/**
 * Whose move first, then LONGEST UNTOUCHED first within each group. Sorting by
 * `updated_at` alone stopped working once a client act refreshes it (B9): the
 * delivery the client just answered, now the studio's to act on, would sink to
 * the bottom of a panel that exists to say what needs the studio today.
 */
export function orderForTriage<Row extends { whoseMove: WhoseMove; updatedAt: string }>(
  rows: readonly Row[],
): Row[] {
  return [...rows].sort(
    (a, b) =>
      GROUP[a.whoseMove] - GROUP[b.whoseMove] ||
      Date.parse(a.updatedAt) - Date.parse(b.updatedAt),
  );
}
