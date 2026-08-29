// Design-Engagement Machine — the cockpit "command card" derivation. PURE and
// CLIENT-SAFE: a re-projection of the SERVER gate preview into the single
// action-surface view the cockpit renders. Mirrors `ui.ts` — NO 'use client',
// NO runtime `@metra/db` import (the `EngagementGatePreview` type below is
// type-only, fully erased at compile time, so importing it from the server-only
// gate-preview module never pulls that module's runtime into a client bundle),
// and it re-reads ONLY the pure registries (`TRANSITIONS`, `PAYLOAD_TRIGGERS`).
//
// TRUTH RULE: the headline reflects what ACTUALLY blocks Advance — the real
// unmet forward-trigger guards from the machine. The client's advisory
// concept/design approval NEVER gates Advance; `advanceEnabled` is true ONLY in
// the all-clear 'ready' mode.
import type { EngagementGatePreview } from './gate-preview';
import type { GuardKey } from './guards';
import type { DesignState } from './states';
import { TRANSITIONS } from './transitions';
import { PAYLOAD_TRIGGERS } from './ui';

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
  /** The state Advance would move to (only in 'ready'); null otherwise. */
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
}

/**
 * Derive the command-card view from the server gate preview. Rules:
 * - terminal, or no forward trigger → 'closed' (no Advance, no nudge).
 * - all forward guards met → 'ready' (Advance enabled iff the role may fire it;
 *   `advanceNeedsForm` = the forward trigger carries a payload).
 * - ≥1 unmet guard that is NOT client-actionable → 'blockedStudio' (Advance
 *   disabled; `primaryBlocker` = the first such studio guard).
 * - all unmet guards are client-actionable → 'blockedClient' (Advance disabled,
 *   nudge shown; `primaryBlocker` = the first unmet guard).
 * `advanceEnabled` is false in every non-'ready' mode.
 */
export function deriveCommandCard(
  preview: EngagementGatePreview,
  opts: { canAdvance: boolean; isTerminal: boolean },
): CommandCardView {
  const { primaryTrigger, items } = preview;

  if (opts.isTerminal || primaryTrigger === null) {
    return {
      mode: 'closed',
      nextPhaseState: null,
      advanceEnabled: false,
      advanceNeedsForm: false,
      blockingGuards: [],
      primaryBlocker: null,
      showNudge: false,
    };
  }

  const unmetGuards = items.filter((item) => !item.ok).map((item) => item.guard);

  if (unmetGuards.length === 0) {
    return {
      mode: 'ready',
      nextPhaseState: TRANSITIONS[primaryTrigger].to,
      advanceEnabled: opts.canAdvance,
      advanceNeedsForm: PAYLOAD_TRIGGERS.has(primaryTrigger),
      blockingGuards: [],
      primaryBlocker: null,
      showNudge: false,
    };
  }

  const studioBlockers = unmetGuards.filter(
    (guard) => !CLIENT_ACTIONABLE_GUARDS.has(guard),
  );

  if (studioBlockers.length > 0) {
    return {
      mode: 'blockedStudio',
      nextPhaseState: null,
      advanceEnabled: false,
      advanceNeedsForm: false,
      blockingGuards: unmetGuards,
      primaryBlocker: studioBlockers[0],
      showNudge: false,
    };
  }

  // Every unmet guard is client-actionable — the studio is done; nudge the client.
  return {
    mode: 'blockedClient',
    nextPhaseState: null,
    advanceEnabled: false,
    advanceNeedsForm: false,
    blockingGuards: unmetGuards,
    primaryBlocker: unmetGuards[0],
    showNudge: true,
  };
}
