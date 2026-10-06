// The command card's VIEW CONSTRUCTORS: one function per presentation, so
// `deriveCommandCard` (command-card.ts) reads as the rule that picks one. PURE
// and CLIENT-SAFE: the type import below is erased at compile time.
import type { CommandCardView } from './command-card';
import type { GuardKey } from './guards';
import type { DesignState } from './states';
import type { Trigger } from './transitions';

/** Terminal, or nowhere left to go: nothing to offer. */
export function closedView(): CommandCardView {
  return {
    mode: 'closed',
    nextPhaseState: null,
    advanceEnabled: false,
    advanceNeedsForm: false,
    blockingGuards: [],
    primaryBlocker: null,
    showNudge: false,
    endingChoices: [],
    endingsEnabled: false,
    awaitingClientReview: false,
    offlineApprovalEnabled: false,
  };
}

/** Every forward guard met, and nobody is waited on: the move is the studio's. */
export function readyView(input: {
  nextPhaseState: DesignState | null;
  advanceEnabled: boolean;
  advanceNeedsForm: boolean;
  endingChoices: Trigger[];
  endingsEnabled: boolean;
}): CommandCardView {
  return {
    mode: 'ready',
    ...input,
    blockingGuards: [],
    primaryBlocker: null,
    showNudge: false,
    awaitingClientReview: false,
    offlineApprovalEnabled: false,
  };
}

/**
 * Held by unmet guards. `blockedClient` (every unmet guard is the client's)
 * still says whether the client also owes the review, so the card can name it;
 * the offline approval is only offered once the guards themselves are met.
 */
export function blockedView(input: {
  mode: 'blockedStudio' | 'blockedClient';
  unmetGuards: GuardKey[];
  primaryBlocker: GuardKey;
  endingChoices: Trigger[];
  awaitingClientReview: boolean;
}): CommandCardView {
  return {
    mode: input.mode,
    nextPhaseState: null,
    advanceEnabled: false,
    advanceNeedsForm: false,
    blockingGuards: input.unmetGuards,
    primaryBlocker: input.primaryBlocker,
    showNudge: input.mode === 'blockedClient',
    endingChoices: input.endingChoices,
    endingsEnabled: false,
    awaitingClientReview: input.mode === 'blockedClient' && input.awaitingClientReview,
    offlineApprovalEnabled: false,
  };
}

/**
 * Every guard met, but the client has not answered the review round in front
 * of them: the card waits for the client (decision 4 keeps that advisory, so the
 * studio may record an approval it took offline when the role may advance).
 */
export function awaitingClientView(input: {
  endingChoices: Trigger[];
  offlineApprovalEnabled: boolean;
}): CommandCardView {
  return {
    mode: 'blockedClient',
    nextPhaseState: null,
    advanceEnabled: false,
    advanceNeedsForm: false,
    blockingGuards: [],
    primaryBlocker: null,
    showNudge: true,
    endingChoices: input.endingChoices,
    endingsEnabled: false,
    awaitingClientReview: true,
    offlineApprovalEnabled: input.offlineApprovalEnabled,
  };
}
