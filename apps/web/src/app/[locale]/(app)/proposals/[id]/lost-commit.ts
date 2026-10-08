// Recovering a save that committed but lost its answer. No React: the autosave
// hook calls this when a save is refused `draft_changed_elsewhere` while an
// earlier save's outcome is still unknown.
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
 * When the stored draft is exactly `unconfirmed` (the save whose answer was
 * lost), that commit was this tab's own: answer the revision and ids to adopt
 * and the current draft re-keyed with them. Null for a real conflict, or when
 * the stored draft cannot be read.
 */
export async function recoverLostCommit(
  unconfirmed: ProposalDraftState,
  current: ProposalDraftState,
): Promise<RecoveredCommit | null> {
  let stored: Awaited<ReturnType<typeof readStoredDraftState>>;
  try {
    stored = await readStoredDraftState(current.id);
  } catch {
    return null;
  }
  if (!stored.ok || !stored.data) return null;
  if (!storedDraftMatches(stored.data, buildProposalPayload(unconfirmed))) return null;
  const idsByKey = storedIdsByKey(unconfirmed.sections, receiptOfStored(stored.data));
  return {
    revision: stored.data.revision,
    idsByKey,
    draft: { ...current, sections: withStoredIds(current.sections, idsByKey) },
  };
}
