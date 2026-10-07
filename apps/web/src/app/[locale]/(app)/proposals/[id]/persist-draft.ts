import { autosaveProposalDraft, saveProposalDraft } from '@/lib/proposals/actions';
import { buildProposalPayload, type ProposalDraftState } from './proposal-payload';

// Saving the draft, the two ways the builder does it. A plain module (no React):
// only the autosave hook calls these; Send, Send as BOQ and Back to delivery reach
// them through its `flush()`. Both send the revision the builder last loaded or
// saved, and both answer with the receipt (new revision, stored line ids).

export type SaveDraftResult = Awaited<ReturnType<typeof saveProposalDraft>>;

type DraftInput = Parameters<typeof saveProposalDraft>[0];

/** A draft save: one state, the revision it was edited from. */
export type SaveDraft = (state: ProposalDraftState, revision: string) => Promise<SaveDraftResult>;

const inputOf = (state: ProposalDraftState, revision: string): DraftInput => ({
  ...(buildProposalPayload(state) as DraftInput),
  revision,
});

/** The explicit save: stores the draft and refreshes the app once. */
export const persistDraft: SaveDraft = (state, revision) =>
  saveProposalDraft(inputOf(state, revision));

/** The silent save after a pause in typing: stores the draft, no refresh. */
export const autosaveDraft: SaveDraft = (state, revision) =>
  autosaveProposalDraft(inputOf(state, revision));
