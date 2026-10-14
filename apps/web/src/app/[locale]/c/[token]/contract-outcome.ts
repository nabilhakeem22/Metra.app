// What the client is told on a contract link once it is no longer open to an
// acknowledgement. PURE: the order of this ladder is a product decision, kept
// out of the JSX so it can be tested and read in one place.

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
export function contractDecidedKey(status: string, outcome: ContractOutcome): 'done' | 'expired' | 'invalid' | 'already' {
  if (outcome === 'signed' || status === 'signed') return 'done';
  if (outcome === 'expired') return 'expired';
  if (outcome === 'invalid') return 'invalid';
  return 'already';
}
