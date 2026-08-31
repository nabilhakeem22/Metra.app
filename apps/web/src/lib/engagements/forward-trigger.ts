// Design-Engagement Machine — the single "what advances from here?" resolve.
// PURE and CLIENT-SAFE: a re-projection of the transition registry with NO db
// runtime, NO 'use client', and NO `server-only`, so the server gate preview, a
// client surface, and a plain unit test all read the SAME rule instead of each
// keeping a copy. Extracted from `gate-preview.ts` (which is server-only, and
// therefore unreachable from a unit test) precisely so the cockpit's next action
// can be asserted without a DB — a replicated copy could drift silently and hand
// back false confidence. Its only dependencies are the pure `ui`, `transitions`
// and `states` modules.
import { STAGE_NUMBER, type DesignState } from './states';
import { TRANSITIONS, type Trigger } from './transitions';
import { legalTriggersFrom } from './ui';

// rejectDesign (bounce back) and abandon (off-ramp) are legal from many states but
// are NOT the forward advance — the hero never proposes them as "what's next".
const NON_FORWARD_TRIGGERS = new Set<Trigger>(['rejectDesign', 'abandon']);

/**
 * The single forward-advance trigger from `state`: the wired, legal trigger (via
 * `legalTriggersFrom`) — excluding the non-forward rejectDesign/abandon — whose
 * destination sits FURTHEST along the funnel (highest `STAGE_NUMBER` of its `to`).
 * Picking the furthest destination naturally selects `confirmConcept` over the
 * `requestRevision` self-loop, `approveDesign` over the `flagAsBuiltVariance`
 * detour, and the change_triage reconciliation back to final_approval — while a
 * terminal (or not-yet-wired) state yields null. Ties resolve to registry order.
 */
export function resolveForwardTrigger(state: DesignState): Trigger | null {
  const candidates = legalTriggersFrom(state).filter(
    (trigger) => !NON_FORWARD_TRIGGERS.has(trigger),
  );
  if (candidates.length === 0) return null;

  let best = candidates[0];
  let bestStage = STAGE_NUMBER[TRANSITIONS[best].to];
  for (const trigger of candidates) {
    const stage = STAGE_NUMBER[TRANSITIONS[trigger].to];
    if (stage > bestStage) {
      best = trigger;
      bestStage = stage;
    }
  }
  return best;
}
