// Recovering a save that committed but lost its answer. No React: the save
// flight (draft-save-flight.ts) calls this when a save is refused
// `draft_changed_elsewhere` while earlier saves' outcomes are still unknown.
import { DRAFT_ANSWER_DEADLINE_MS, NO_ANSWER, settleWithinDeadline } from './draft-answer-deadline';
import { storedIdsByKey, withStoredIds } from './draft-save-receipt';
import { readStoredDraftState } from './persist-draft';
import { buildProposalPayload, type ProposalDraftState } from './proposal-payload';
import { receiptOfStored, storedDraftMatches } from './stored-draft-match';

export interface RecoveredCommit {
  /** The stored revision to save against from now on. */
  revision: string;
  /** Row key -> the id the lost save stored that line under. */
  idsByKey: Map<string, string>;
  /** The draft to send again: `current` with those ids. */
  draft: ProposalDraftState;
}

/**
 * When the stored draft is exactly one of the saves whose answers were lost
 * (`latest`, then `earlier`, newest first: the first that matches is the one
 * whose rows the current draft most likely still has), that commit was this
 * tab's own: answer the revision and ids to adopt and the current draft re-keyed
 * with them. Null for a real conflict: the stored draft was read and is none of
 * them. `'unreadable'` when it could not be read, so whose commit it holds is
 * still unknown.
 */
export async function recoverLostCommit(
  latest: ProposalDraftState,
  current: ProposalDraftState,
  earlier: readonly ProposalDraftState[],
): Promise<RecoveredCommit | 'unreadable' | null> {
  const stored = await readStoredDraft(current.id);
  if (!stored) return 'unreadable';
  const ours = [latest, ...earlier].find((sent) => storedDraftMatches(stored, buildProposalPayload(sent)));
  if (!ours) return null;
  const idsByKey = storedIdsByKey(ours.sections, receiptOfStored(stored));
  return {
    revision: stored.revision,
    idsByKey,
    draft: { ...current, sections: withStoredIds(current.sections, idsByKey) },
  };
}

/** The stored draft, or null when the read threw, was refused, or did not answer within the deadline. */
function readStoredDraft(proposalId: string) {
  return settleWithinDeadline(
    () => readStoredDraftState(proposalId),
    DRAFT_ANSWER_DEADLINE_MS,
    (answer) => (answer === NO_ANSWER || !answer.ok ? null : (answer.data ?? null)),
  );
}
