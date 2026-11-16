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

/** How many unconfirmed drafts a flight keeps: the first sent and the newest seven. */
const UNCONFIRMED_SENDS_KEPT = 8;

/**
 * `sends` (newest first) after `draft` was answered `result`. An ok answer
 * confirms a save from the revision they all share, so none of the others can
 * have committed: nothing is left. An answer that leaves the commit unknown
 * (`uncertain`, `generic`) adds `draft`. Any other refusal changes nothing.
 */
export function unconfirmedAfter(
  sends: readonly ProposalDraftState[],
  draft: ProposalDraftState,
  result: SaveDraftResult,
): readonly ProposalDraftState[] {
  if (result.ok) return [];
  if (result.error === 'generic' || result.error === 'uncertain') return withUnconfirmedSend(sends, draft);
  return sends;
}

/**
 * `sends` (newest first) with `draft` as the newest. The same draft sent again
 * (Retry) is kept once. Past the bound, the one dropped is the oldest BUT ONE:
 * the first send stays because it is the likeliest to have committed (it was
 * already on its way when the connection dropped or the server slowed), and
 * the newest stay because their rows are the likeliest to be in the current
 * draft still.
 */
function withUnconfirmedSend(
  sends: readonly ProposalDraftState[],
  draft: ProposalDraftState,
): ProposalDraftState[] {
  const kept = [draft, ...sends.filter((sent) => sent !== draft)];
  if (kept.length > UNCONFIRMED_SENDS_KEPT) kept.splice(kept.length - 2, 1);
  return kept;
}
