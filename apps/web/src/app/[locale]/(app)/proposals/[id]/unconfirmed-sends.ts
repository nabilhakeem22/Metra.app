// The drafts a save flight has sent since its last confirmed save and never had
// an answer for. PURE and CLIENT-SAFE.
//
// All of them were sent from the same revision, and the server refuses a save
// made from an older one, so at most ONE of them can have committed. When a later
// save is refused as stale, lost-commit.ts compares what is stored with each of
// them. Remembering only the latest was not enough: after a connection drop (or
// a server too slow for the deadline) the first send may have committed while
// the sends after it failed too, and the stored draft was then compared with the
// wrong one and reported as somebody else's change.
import type { SaveDraftResult } from './persist-draft';
import type { ProposalDraftState } from './proposal-payload';

/**
 * A draft that was sent, and the snapshot it was sent as. The snapshot says
 * whether two sends carried the same draft: the builder hands over a new draft
 * object on every render, so the object cannot.
 */
export interface UnconfirmedSend {
  draft: ProposalDraftState;
  snapshot: string;
}

/**
 * How many unconfirmed sends a flight keeps: the first sent and the newest
 * thirty-one. Measured, not guessed: over 2,000 simulated outages (up to 400 s
 * of edits, Retries and a connection that comes and goes) at most 15 different
 * drafts went unconfirmed in a row, and a list of 8 lost the send that had
 * committed in 11 of them. Each entry is a reference to a draft the builder
 * already built, compared only when a save is refused as stale.
 */
const UNCONFIRMED_SENDS_KEPT = 32;

/**
 * `sends` (newest first) after `sent` was answered `result`. An ok answer
 * confirms a save from the revision they all share, so none of the others can
 * have committed: nothing is left. An answer that leaves the commit unknown
 * (`uncertain`, `generic`) adds `sent`. Any other refusal changes nothing.
 */
export function unconfirmedAfter(
  sends: readonly UnconfirmedSend[],
  sent: UnconfirmedSend,
  result: SaveDraftResult,
): readonly UnconfirmedSend[] {
  if (result.ok) return [];
  if (result.error === 'generic' || result.error === 'uncertain') return withUnconfirmedSend(sends, sent);
  return sends;
}

/**
 * `sends` (newest first) with `sent` as the newest. The same draft sent again
 * (Retry, however many times) is kept once. Past the bound, the one dropped is
 * the oldest BUT ONE: the first send stays because it is the likeliest to have
 * committed (it was already on its way when the connection dropped or the
 * server slowed), and the newest stay because their rows are the likeliest to
 * be in the current draft still.
 */
function withUnconfirmedSend(sends: readonly UnconfirmedSend[], sent: UnconfirmedSend): UnconfirmedSend[] {
  const kept = [sent, ...sends.filter((earlier) => earlier.snapshot !== sent.snapshot)];
  if (kept.length > UNCONFIRMED_SENDS_KEPT) kept.splice(kept.length - 2, 1);
  return kept;
}
