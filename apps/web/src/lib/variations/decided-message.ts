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
  | 'expired'
  | 'invalid'
  | 'already';

export interface VariationDecisionState {
  /** The variation row's own status. */
  status: string;
  /** False once the parent contract has been terminated. */
  contractActive: boolean;
  outcome: VariationOutcome;
}

/**
 * THE ORDER IS THE POINT.
 *
 * `approved` outranks `contractInactive` (F6). A variation the client approved,
 * on a contract that was terminated afterwards, used to read as "this contract
 * is no longer active" — true of the contract, and false about the thing the
 * client is looking at. Their approval happened; the page must not appear to
 * deny it.
 *
 * `contractInactive` still outranks `rejected`, for the opposite reason: a
 * terminated contract AUTO-REJECTS its open variations, so the row's own status
 * would otherwise tell the client they rejected it themselves when they never
 * touched it.
 *
 * `already` is the fall-through rather than a case of its own: every other
 * branch is a thing we can name, and "you have already responded" is what is
 * left when we cannot.
 */
export function variationDecidedKey(
  state: VariationDecisionState,
): VariationDecidedKey {
  const { status, contractActive, outcome } = state;
  if (outcome === 'approved' || status === 'approved') return 'approved';
  if (!contractActive || outcome === 'contractInactive') return 'contractInactive';
  if (outcome === 'rejected' || status === 'rejected') return 'rejected';
  if (outcome === 'expired') return 'expired';
  if (outcome === 'invalid') return 'invalid';
  return 'already';
}

/** Is the page past the point of accepting a decision at all? */
export function variationIsDecided(state: VariationDecisionState): boolean {
  return !state.contractActive || state.status !== 'issued' || state.outcome !== null;
}
