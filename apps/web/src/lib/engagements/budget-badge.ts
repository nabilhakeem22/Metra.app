import { acknowledgesIssuance, type AcknowledgementEvent } from './rom-ack';

/**
 * Which badge the Budget tab wears, if any.
 *
 * PURE and CLIENT-SAFE: no `server-only`, no database, no React. It has to be,
 * because it is a product rule about what the studio is TOLD, and a rule spelled
 * out inline in a tab strip is one nobody can test and everybody edits.
 */

/**
 * TWO states, not one. A band the studio has typed but not sent is a DRAFT and
 * the client cannot see it; a band that has been sent and not yet acknowledged is
 * AWAITING the client. Conflating them told the studio to chase a client who had
 * never been shown anything.
 */
export type BudgetBadge = 'draft' | 'awaitingAck' | null;

/** Only the three header fields the question needs. */
export interface BudgetBadgeHeader {
  romLow: string | null;
  romHigh: string | null;
  romIssuedAt: Date | null;
}

export function resolveBudgetBadge(
  header: BudgetBadgeHeader,
  events: readonly AcknowledgementEvent[],
): BudgetBadge {
  // A band must EXIST to be a draft: without one there is nothing drafted, and a
  // permanent "draft" badge on every young engagement says nothing at all.
  if (header.romLow !== null && header.romHigh !== null && header.romIssuedAt === null) {
    return 'draft';
  }
  // 0049: the acknowledgement must answer THIS issuance. A stale one against a
  // superseded band leaves the studio still awaiting the client, which is what
  // the server-side romAcknowledged guard already decides — both call
  // acknowledgesIssuance so the badge and the gate cannot disagree.
  if (
    header.romIssuedAt !== null &&
    !events.some((event) => acknowledgesIssuance(event, header.romIssuedAt))
  ) {
    return 'awaitingAck';
  }
  return null;
}
