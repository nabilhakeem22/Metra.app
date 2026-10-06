// Design-Engagement Machine — the cockpit "command card" derivation. PURE and
// CLIENT-SAFE: a re-projection of the SERVER gate preview into the single
// action-surface view the cockpit renders. Mirrors `ui.ts` — NO 'use client',
// NO runtime `@metra/db` import (the `EngagementGatePreview` type below is
// type-only, fully erased at compile time, so importing it from the server-only
// gate-preview module never pulls that module's runtime into a client bundle),
// and it re-reads ONLY the pure registries (`TRANSITIONS`, `PAYLOAD_TRIGGERS`).
//
// TRUTH RULE: the headline reflects what ACTUALLY blocks Advance: the real
// unmet forward-trigger guards from the machine. The client's concept/design
// approval is never a guard; at the two review stages the card waits for the
// client's answer instead of offering Advance (a SOFT block, client-review.ts),
// and the studio may record an approval it took offline. `advanceEnabled` is
// true ONLY in the all-clear 'ready' mode.
import type { EngagementGatePreview } from './gate-preview';
import type { GuardKey } from './guards';
import type { DesignState } from './states';
import { TRANSITIONS, type Trigger } from './transitions';
import { PAYLOAD_TRIGGERS } from './ui';
import { awaitingClientView, blockedView, closedView, readyView } from './command-card-views';

/**
 * The guards a CLIENT clears by acting on their delivery link — the milestone
 * money gates plus the handoff acknowledgement (the client's own
 * `acknowledge_handoff` token action). When every unmet forward guard is one of
 * these, the studio has nothing left to do and the card reads "waiting on the
 * client" (with a nudge). Any OTHER unmet guard is studio work and takes
 * precedence.
 */
export const CLIENT_ACTIONABLE_GUARDS: ReadonlySet<GuardKey> = new Set<GuardKey>([
  'depositCleared',
  'gateAInstallmentCleared',
  'gateBInstallmentCleared',
  'balanceCleared',
  'revisionCosSettled',
  'handoffAcknowledged',
]);

/** Which of the four command-card presentations the current gate resolves to. */
export type CommandCardMode = 'closed' | 'ready' | 'blockedStudio' | 'blockedClient';

/** The single action-surface view the cockpit command card renders. */
export interface CommandCardView {
  mode: CommandCardMode;
  /** The state Advance would move to (only in 'ready' with a forward trigger); null otherwise. */
  nextPhaseState: DesignState | null;
  /** Advance is offered ONLY in the all-clear 'ready' mode AND the role may fire it. */
  advanceEnabled: boolean;
  /** In 'ready', does the forward trigger open a payload form vs. fire directly? */
  advanceNeedsForm: boolean;
  /** Every unmet forward guard (empty unless a blocked mode). */
  blockingGuards: GuardKey[];
  /** The one guard to name in the headline/note (first studio, else first unmet). */
  primaryBlocker: GuardKey | null;
  /** Show the "nudge client" affordance (only when the client is the sole blocker). */
  showNudge: boolean;
  /** The endings the card offers as equal choices (set in every non-closed mode). */
  endingChoices: Trigger[];
  /** The ending buttons are enabled ONLY in 'ready' AND the role may fire them. */
  endingsEnabled: boolean;
  /** A review stage whose current round the client has not answered (client-review.ts). */
  awaitingClientReview: boolean;
  /** Offer "Client approved offline": guards met, waiting, and the role may advance. */
  offlineApprovalEnabled: boolean;
}

type CommandCardPreview = Pick<
  EngagementGatePreview,
  'primaryTrigger' | 'endingChoices' | 'items' | 'awaitingClientReview'
>;

/** Every move forward the card may offer: the forward trigger, or the endings. */
export function forwardMovesOf(
  preview: Pick<EngagementGatePreview, 'primaryTrigger' | 'endingChoices'>,
): Trigger[] {
  return preview.primaryTrigger ? [preview.primaryTrigger] : [...preview.endingChoices];
}

/**
 * Derive the command-card view from the server gate preview. Rules:
 * - terminal, or neither a forward trigger nor an ending → 'closed'.
 * - all forward guards met but the client has not answered the review round
 *   (`awaitingClientReview`) → 'blockedClient' with no blocker, waiting on the
 *   client; the offline approval is offered when the role may advance.
 * - all forward guards met otherwise → 'ready' (Advance enabled iff there is a
 *   forward trigger and the role may fire it; at a choice state the endings are
 *   enabled instead, and Advance stays off).
 * - ≥1 unmet guard that is NOT client-actionable → 'blockedStudio'
 *   (`primaryBlocker` = the first such studio guard).
 * - all unmet guards are client-actionable → 'blockedClient' (nudge shown;
 *   `primaryBlocker` = the first unmet guard).
 * `advanceEnabled` and `endingsEnabled` are false in every non-'ready' mode.
 */
export function deriveCommandCard(
  preview: CommandCardPreview,
  opts: { canAdvance: boolean; isTerminal: boolean },
): CommandCardView {
  const { primaryTrigger, endingChoices, items, awaitingClientReview } = preview;

  if (opts.isTerminal || (primaryTrigger === null && endingChoices.length === 0)) {
    return closedView();
  }

  const unmetGuards = items.filter((item) => !item.ok).map((item) => item.guard);

  if (unmetGuards.length === 0) {
    if (awaitingClientReview) {
      return awaitingClientView({
        endingChoices,
        offlineApprovalEnabled: opts.canAdvance && primaryTrigger !== null,
      });
    }
    return readyView({
      nextPhaseState: primaryTrigger ? TRANSITIONS[primaryTrigger].to : null,
      advanceEnabled: opts.canAdvance && primaryTrigger !== null,
      advanceNeedsForm: primaryTrigger !== null && PAYLOAD_TRIGGERS.has(primaryTrigger),
      endingChoices,
      endingsEnabled: opts.canAdvance && endingChoices.length > 0,
    });
  }

  const studioBlockers = unmetGuards.filter(
    (guard) => !CLIENT_ACTIONABLE_GUARDS.has(guard),
  );
  const mode = studioBlockers.length > 0 ? 'blockedStudio' : 'blockedClient';
  return blockedView({
    mode,
    unmetGuards,
    // The first studio blocker, else (every unmet guard is the client's) the first.
    primaryBlocker: studioBlockers[0] ?? unmetGuards[0],
    endingChoices,
    awaitingClientReview,
  });
}
