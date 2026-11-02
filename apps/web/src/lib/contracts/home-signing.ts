// Where a contract is signed online. PURE and CLIENT-SAFE: the /c page reads it
// to show a notice in place of the sign box, and the /c action reads it to
// refuse the acknowledgement before any write.
import type { PublicContract } from './public-types';

/**
 * A BOQ (execution) contract is signed in the client home with a one-time code
 * (H6.2); its /c link only shows it. A proposal contract still signs on /c (OD3).
 */
export function signsInClientHome(contract: Pick<PublicContract, 'source'>): boolean {
  return contract.source === 'boq';
}

/** Awaiting the client's signature, in its window: the SQL's own `signing_open` rule (no end date is no end). */
export function isOpenForSigning(contract: Pick<PublicContract, 'status' | 'share_expires_at'>, now: number): boolean {
  if (contract.status !== 'issued') return false;
  return contract.share_expires_at === null || Date.parse(contract.share_expires_at) > now;
}
