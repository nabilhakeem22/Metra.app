// Where a change order is decided online. PURE and CLIENT-SAFE: the /v page
// reads it to show a notice in place of the decision, and the /v action reads
// it to refuse the decision before any write.
import type { PublicVariation } from './public-types';

/**
 * A BOQ (execution) contract's change order is decided in the client home with
 * a one-time code (H7.1); its /v link only shows it. A proposal contract's is
 * still decided on /v.
 */
export function decidesInClientHome(variation: Pick<PublicVariation, 'contractSource'>): boolean {
  return variation.contractSource === 'boq';
}

/** Awaiting the client's decision, in its window: the SQL's own rule for a live order (no end date is no end). */
export function isOpenForDecision(
  variation: Pick<PublicVariation, 'status' | 'contractActive' | 'share_expires_at'>,
  now: number,
): boolean {
  if (variation.status !== 'issued' || !variation.contractActive) return false;
  return variation.share_expires_at === null || Date.parse(variation.share_expires_at) > now;
}
