import 'server-only';
// Right before a review write, is the delivery still what the client saw when
// they confirmed (fix round F1/F2, S1)? A fresh read through the client's own
// token, compared with the fingerprint the page sent (../review-seen.ts).
import { bandSeenOf, roundSeenOf, type ReviewSeen } from '../review-seen';
import { savedDelivery } from './saved-delivery';

/**
 * True when every part given still matches (a part left out is not compared).
 * A delivery that cannot be read right now is NOT as seen: nothing is written
 * on the strength of a read that failed, and the page re-reads.
 */
export async function stillAsSeen(rawToken: string, expected: Partial<ReviewSeen>): Promise<boolean> {
  const current = await savedDelivery(rawToken);
  if (!current) return false;
  if (expected.band !== undefined && bandSeenOf(current) !== expected.band) return false;
  if (expected.round !== undefined && roundSeenOf(current) !== expected.round) return false;
  return true;
}
