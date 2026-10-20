// What the client is told on a contract link once it is no longer open to an
// acknowledgement. PURE: the order of this ladder is a product decision, kept
// out of the JSX so it can be tested and read in one place.
import type { PublicContract } from '@/lib/contracts/public-types';

/** What the client's own click resolved to, or null if it has not landed. */
export type ContractOutcome = 'signed' | 'already' | 'expired' | 'invalid' | null;

/** A landed answer as an outcome. A failed act never gets here (unansweredFailure). */
export function contractOutcomeOf(result: { ok: boolean; error?: string }): Exclude<ContractOutcome, null> {
  if (result.ok) return 'signed';
  if (result.error === 'token_expired') return 'expired';
  if (result.error === 'already_responded') return 'already';
  return 'invalid';
}

/** The sentence under `contracts.ack` for an acknowledged or closed contract. */
export type ContractDecidedKey = 'done' | 'signedOnline' | 'signedPaper' | 'signed' | 'expired' | 'invalid' | 'already';

/**
 * The client's own click just now is thanked (`done`). A contract signed
 * before this visit says the day and the way it was signed: on paper, as the
 * studio recorded (never "your acknowledgement has been recorded", A3 F3), or
 * online. A signed contract with no signing event on record says only that it
 * is signed.
 */
export function contractDecidedKey(
  contract: Pick<PublicContract, 'status' | 'signed'>,
  outcome: ContractOutcome,
): ContractDecidedKey {
  if (outcome === 'signed') return 'done';
  if (contract.status === 'signed') {
    if (!contract.signed) return 'signed';
    return contract.signed.via === 'paper' ? 'signedPaper' : 'signedOnline';
  }
  if (outcome === 'expired') return 'expired';
  if (outcome === 'invalid') return 'invalid';
  return 'already';
}
