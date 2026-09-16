/**
 * Which single sentence a client sees on a variation-order page that is no
 * longer open to a decision.
 *
 * PURE and CLIENT-SAFE: no imports. Extracted from the page because the ORDER of
 * this ladder is a product decision about what a client is told, and a ladder
 * spelled out inline in JSX is one nobody can test and everybody edits.
 */

/** What the client's own click resolved to, or null if they have not clicked. */
export type VariationOutcome =
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'invalid'
  | 'contractInactive'
  | 'already'
  | null;

/** The message key under `variations.client`. */
export type VariationDecidedKey =
  | 'approved'
  | 'contractInactive'
  | 'rejected'
  | 'rejectedOnTermination'
  | 'expired'
  | 'invalid'
  | 'already';

export interface VariationDecisionState {
  /** The variation row's own status. */
  status: string;
  /** False once the parent contract has been terminated. */
  contractActive: boolean;
  outcome: VariationOutcome;
  /**
   * WHO rejected it (0051): 'client' their own refusal, 'staff' the termination
   * cascade, null for a row written before the column existed.
   */
  rejectionChannel: 'client' | 'staff' | null;
}

/**
 * THE ORDER IS THE WHOLE CONTRACT, and every line below is load-bearing.
 *
 * 1. `approved` outranks everything (F6). A variation the client approved, on a
 *    contract terminated afterwards, used to read as "this contract is no longer
 *    active" — true of the contract, and false about the thing the client is
 *    looking at. Their approval happened; the page must not appear to deny it.
 *
 * 2/3. A RECORDED REJECTION IS READ, NOT GUESSED (0051). `rejectionChannel`
 *    says who rejected it: 'staff' is the termination cascade (the client never
 *    touched it, so say so plainly), 'client' is their own refusal — which must
 *    outrank `contractInactive`, because the defect this fixes is a client who
 *    rejected a variation, watched the contract be terminated, and was then told
 *    "this contract is no longer in force" as though they had never decided.
 *
 * 4. Their click, this session, before any refresh.
 *
 * 5. `contractInactive` for everything else on a dead contract.
 *
 * 6. THE LEGACY ROW, AND WHY THERE IS NO REGRESSION. `rejectionChannel` is null
 *    for every event written before 0051 and there is NO backfill (A2 — every
 *    discriminator survives both paths, so a backfill would be a guess on an
 *    evidentiary record). A null-channel rejection on a LIVE contract reaches
 *    this line and reads `rejected`, exactly as it does today; on a terminated
 *    contract it stops at rule 5 and reads `contractInactive`, exactly as it
 *    does today. Deleting this line as "unreachable" would silently re-label
 *    every historical rejection.
 *
 * `already` is the fall-through rather than a case of its own: every other
 * branch is a thing we can name, and "you have already responded" is what is
 * left when we cannot.
 */
export function variationDecidedKey(
  state: VariationDecisionState,
): VariationDecidedKey {
  const { status, contractActive, outcome, rejectionChannel } = state;
  if (outcome === 'approved' || status === 'approved') return 'approved';
  if (status === 'rejected' && rejectionChannel === 'staff') {
    return 'rejectedOnTermination';
  }
  if (status === 'rejected' && rejectionChannel === 'client') return 'rejected';
  if (outcome === 'rejected') return 'rejected';
  if (!contractActive || outcome === 'contractInactive') return 'contractInactive';
  if (status === 'rejected') return 'rejected';
  if (outcome === 'expired') return 'expired';
  if (outcome === 'invalid') return 'invalid';
  return 'already';
}

/** Is the page past the point of accepting a decision at all? */
export function variationIsDecided(state: VariationDecisionState): boolean {
  return !state.contractActive || state.status !== 'issued' || state.outcome !== null;
}
