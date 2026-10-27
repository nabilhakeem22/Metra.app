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
