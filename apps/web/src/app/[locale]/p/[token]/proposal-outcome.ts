// What the client is told on a proposal link once it is no longer open to a
// decision. PURE: the order of this ladder is a product decision, kept out of
// the JSX so it can be tested and read in one place.

/** What the client's own click resolved to, or null if it has not landed. */
export type ProposalOutcome = 'accepted' | 'rejected' | 'already' | 'expired' | null;

/** A landed answer as an outcome. A failed act never gets here (unansweredFailure). */
export function proposalOutcomeOf(
  result: { ok: boolean; error?: string },
  decision: 'accept' | 'reject',
): Exclude<ProposalOutcome, null> {
  if (result.ok) return decision === 'accept' ? 'accepted' : 'rejected';
  return result.error === 'token_expired' ? 'expired' : 'already';
}

/** The sentence under `proposals.p` for a decided proposal. */
export function proposalDecidedKey(
  status: string,
  outcome: ProposalOutcome,
): 'decisionAccepted' | 'decisionRejected' | 'expired' | 'alreadyResponded' {
  if (outcome === 'accepted' || status === 'accepted') return 'decisionAccepted';
  if (outcome === 'rejected' || status === 'rejected') return 'decisionRejected';
  if (outcome === 'expired') return 'expired';
  return 'alreadyResponded';
}
