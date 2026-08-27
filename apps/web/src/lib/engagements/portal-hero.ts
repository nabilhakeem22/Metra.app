// Client-portal (P2 redesign) hero derivation. PURE and SERVER-SAFE: no
// `@metra/db` runtime value, no 'use client'. Turns the SDF-computed client-action
// verbs + the machine state into the SINGLE "one thing that needs you now" hero
// the portal renders — never the raw machine state name reaches the client. Both
// the server read path (`public.ts`, which reuses CLIENT_ACTION_VERBS as its verb
// whitelist) and a colocated unit test import from here.
//
// The `import type` below is erased at compile time — it only borrows the DUE-only
// milestone shape, so this stays a pure module (no server-only runtime is pulled).
import type { DesignState } from './states';
import type { PublicDeliveryMilestone } from './public';

/**
 * The SIX client-facing verb tokens the SDF may emit — the exhaustive whitelist.
 * `public.ts` filters the raw `client_actions` array to THIS set (an unknown verb
 * is dropped, never rendered), and `deriveHero` reads it. Kept as the single
 * source of truth so the read path and the view can never drift.
 */
export const CLIENT_ACTION_VERBS: ReadonlySet<string> = new Set<string>([
  'approve_concept',
  'request_concept_changes',
  'approve_design',
  'request_design_changes',
  'acknowledge_rom',
  'acknowledge_handoff',
]);

/** The four hero presentations the portal can show. */
export type HeroKind = 'action' | 'inProgress' | 'delivered' | 'closed';

/** Which action group the hero offers when `kind === 'action'`. */
export type HeroGroup = 'concept' | 'design' | 'handoff';

/** The single "what needs you now" view the hero card renders. */
export interface HeroView {
  kind: HeroKind;
  /** The action group to offer (only when `kind === 'action'`). */
  group?: HeroGroup;
  /** Budget acknowledgement is offered as a SUBORDINATE card — never the hero. */
  showRomAck: boolean;
}

/** The two TERMINAL "the design is delivered" states (calm delivered hero). */
const DELIVERED_STATES = new Set<DesignState>(['closed_design_only', 'execution']);

/**
 * Derive the hero from the client-actionable verbs + the current state.
 * Precedence for the actionable hero is **design > concept > handoff** (a final
 * sign-off outranks an earlier concept review, which outranks a wrap-up handoff).
 * `acknowledge_rom` is NEVER the hero — it surfaces as a subordinate card via
 * `showRomAck`. With no actionable group the hero is calm: `delivered` for the two
 * terminal delivered states, `closed` for `abandoned`, else `inProgress`.
 */
export function deriveHero(
  clientActions: string[],
  state: DesignState,
): HeroView {
  const actions = (clientActions ?? []).filter((verb) =>
    CLIENT_ACTION_VERBS.has(verb),
  );
  const showRomAck = actions.includes('acknowledge_rom');

  if (
    actions.includes('approve_design') ||
    actions.includes('request_design_changes')
  ) {
    return { kind: 'action', group: 'design', showRomAck };
  }
  if (
    actions.includes('approve_concept') ||
    actions.includes('request_concept_changes')
  ) {
    return { kind: 'action', group: 'concept', showRomAck };
  }
  if (actions.includes('acknowledge_handoff')) {
    return { kind: 'action', group: 'handoff', showRomAck };
  }

  if (DELIVERED_STATES.has(state)) return { kind: 'delivered', showRomAck };
  if (state === 'abandoned') return { kind: 'closed', showRomAck };
  return { kind: 'inProgress', showRomAck };
}

/** The at-a-glance payment summary — DUE amounts only, never cost. */
export interface PaymentGlance {
  /** The deposit milestone is fully paid. */
  depositPaid: boolean;
  /** The first not-fully-paid milestone (partial or due), or null when settled. */
  nextDue: { milestone_kind: string; amount_due: string } | null;
  /** Every milestone in the schedule is paid (and there is at least one). */
  allSettled: boolean;
}

/**
 * Reduce the DUE-only payment schedule to the calm money glance the portal shows:
 * a "deposit received" chip and the next amount coming up. Cost-free by
 * construction — the schedule the SDF returns carries only client-DUE amounts.
 */
export function paymentGlance(
  schedule: PublicDeliveryMilestone[],
): PaymentGlance {
  const rows = Array.isArray(schedule) ? schedule : [];
  const depositPaid = rows.some(
    (row) => row.milestone_kind === 'deposit' && row.status === 'paid',
  );
  const nextUnsettled = rows.find((row) => row.status !== 'paid') ?? null;
  const nextDue = nextUnsettled
    ? { milestone_kind: nextUnsettled.milestone_kind, amount_due: nextUnsettled.amount_due }
    : null;
  const allSettled = rows.length > 0 && rows.every((row) => row.status === 'paid');
  return { depositPaid, nextDue, allSettled };
}
