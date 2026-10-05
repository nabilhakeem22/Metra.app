import { saveProposalDraft } from '@/lib/proposals/actions';
import { buildProposalPayload, type ProposalDraftState } from './proposal-payload';

// Saving the draft, shared by every builder control that must save FIRST: Save,
// Send, Send as BOQ and Back to delivery. A plain module (no React), so the BOQ
// hooks and the quote actions call the one function.

export type SaveDraftResult = Awaited<ReturnType<typeof saveProposalDraft>>;

/** The draft, as the server takes it. The cast is the action's own input type. */
export function persistDraft(state: ProposalDraftState): Promise<SaveDraftResult> {
  return saveProposalDraft(
    buildProposalPayload(state) as Parameters<typeof saveProposalDraft>[0],
  );
}
