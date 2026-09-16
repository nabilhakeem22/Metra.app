// Design-Engagement Machine — server-safe UI helpers. PURE and CLIENT-SAFE: a
// re-projection of the transition registry with NO db import and NO 'use client'.
// It reads ONLY the type-erased/pure modules `transitions.ts` (which imports only
// `type`s from @metra/db) and `states.ts`, so a client component may import it
// directly without turning a `@metra/db` runtime value into a client-reference
// proxy. Do NOT import any runtime value from `@metra/db`, `queries.ts` or
// `actions.ts` here.
import { can } from '../permissions/can';
import type { MemberRole } from '../permissions/roles';
import { CAPABILITY_ACTION, TRANSITIONS, type Trigger } from './transitions';
import type { DesignState } from './states';

/**
 * The triggers that are legal FROM `state`: their `from` includes the state.
 * Returned in the registry's declaration order — the UI renders them as the
 * engagement's next-action buttons. A terminal state yields an empty list.
 */
export function legalTriggersFrom(state: DesignState): Trigger[] {
  return (Object.keys(TRANSITIONS) as Trigger[]).filter((trigger) => {
    const from = TRANSITIONS[trigger].from;
    return Array.isArray(from) ? from.includes(state) : from === state;
  });
}

/**
 * Triggers that carry a payload and therefore open a form instead of firing
 * directly: `submitDesignFee` (design fee + milestone split) and the two revision
 * edges — `requestRevision` (concept) and `designChangeRaised` (3D) — which both
 * take an optional reason plus the change-order amount that becomes required once
 * the revision crosses the free allowance. Every other trigger fires with no
 * input.
 */
export const PAYLOAD_TRIGGERS: ReadonlySet<Trigger> = new Set<Trigger>([
  'submitDesignFee',
  'requestRevision',
  'designChangeRaised',
]);

/** Does firing this trigger need a payload form (vs. a direct click)? */
export function triggerNeedsForm(trigger: Trigger): boolean {
  return PAYLOAD_TRIGGERS.has(trigger);
}

/**
 * May `role` fire `trigger`? Checks the trigger's capability family at the same
 * action the executor gates on — so a hidden button matches the server gate
 * exactly (the button is convenience; the action is the real fence).
 */
export function canRunTrigger(role: MemberRole, trigger: Trigger): boolean {
  const capability = TRANSITIONS[trigger].capability;
  return can(role, capability, CAPABILITY_ACTION[capability]);
}
