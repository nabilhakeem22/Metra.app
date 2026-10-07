import { autosaveProposalDraft, saveProposalDraft } from '@/lib/proposals/actions';
import { buildProposalPayload, type ProposalDraftState } from './proposal-payload';

// Saving the draft, the two ways the builder does it. A plain module (no React):
// only the autosave hook calls these; Send, Send as BOQ and Back to delivery reach
// them through its `flush()`.

export type SaveDraftResult = Awaited<ReturnType<typeof saveProposalDraft>>;

type DraftInput = Parameters<typeof saveProposalDraft>[0];

/** The explicit save: stores the draft and refreshes the app once. The cast is
 *  the action's own input type. */
export function persistDraft(state: ProposalDraftState): Promise<SaveDraftResult> {
  return saveProposalDraft(buildProposalPayload(state) as DraftInput);
}

/** The silent save after a pause in typing: stores the draft, no refresh. */
export function autosaveDraft(state: ProposalDraftState): Promise<SaveDraftResult> {
  return autosaveProposalDraft(buildProposalPayload(state) as DraftInput);
}
