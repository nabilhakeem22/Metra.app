// Design-Engagement Machine — WHOSE MOVE is it? PURE and CLIENT-SAFE: one rule,
// read by the delivery page, the deliveries list and the dashboard, so the three
// can never disagree about the same delivery. It is a re-projection of the
// command card's own mode (`deriveCommandCard`) plus the pending client payment
// claims, not a per-state table kept by hand.
import { deriveCommandCard, type CommandCardMode } from './command-card';
import type { EngagementGatePreview } from './gate-preview';
import { isTerminal, type DesignState } from './states';

export type WhoseMove = 'studio' | 'client' | 'confirmPayment' | 'closed';

/**
 * closed stays closed; a pending client payment claim is the studio's to
 * confirm in every live mode; otherwise the client holds the move only when the
 * card is blocked on the client alone.
 */
export function whoseMoveOfMode(mode: CommandCardMode, pendingClaimCount: number): WhoseMove {
  if (mode === 'closed') return 'closed';
  if (pendingClaimCount > 0) return 'confirmPayment';
  return mode === 'blockedClient' ? 'client' : 'studio';
}

export interface WhoseMoveInput {
  state: DesignState;
  preview: Pick<
    EngagementGatePreview,
    'primaryTrigger' | 'endingChoices' | 'items' | 'awaitingClientReview'
  >;
  pendingClaimCount: number;
}

/** Whose move it is for one delivery. Role-independent: `canAdvance` never changes the mode. */
export function resolveWhoseMove(input: WhoseMoveInput): WhoseMove {
  const view = deriveCommandCard(input.preview, {
    canAdvance: false,
    isTerminal: isTerminal(input.state),
  });
  return whoseMoveOfMode(view.mode, input.pendingClaimCount);
}
