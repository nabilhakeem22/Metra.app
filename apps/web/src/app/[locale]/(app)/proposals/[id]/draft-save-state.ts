// The builder's save state, derived (no React): what a save would send compared
// with what was last stored, and the last refusal.
import { buildProposalPayload, type ProposalDraftState } from './proposal-payload';

export type DraftSaveState = 'saved' | 'dirty' | 'saving' | 'failed';

/** What a save would send, as one comparable string. */
export function snapshotOf(state: ProposalDraftState): string {
  return JSON.stringify(buildProposalPayload(state));
}

/**
 * Saved when what a save would send equals what was last stored (so undoing an
 * edit is "saved" again), failed when the last attempt at exactly this content
 * was refused, else dirty; saving while a save runs.
 */
export function draftSaveStateOf(input: {
  saving: boolean;
  snapshot: string;
  storedSnapshot: string;
  refusedSnapshot: string | undefined;
}): DraftSaveState {
  if (input.saving) return 'saving';
  if (input.snapshot === input.storedSnapshot) return 'saved';
  return input.refusedSnapshot === input.snapshot ? 'failed' : 'dirty';
}
