// Client-portal (P2 redesign) hero derivation. PURE and SERVER-SAFE: no
// `@metra/db` runtime value, no 'use client'. Turns the SDF-computed client-action
// verbs + the machine state into the SINGLE "one thing that needs you now" hero
// the portal renders — never the raw machine state name reaches the client. Both
// the server read path (`public.ts`, which reuses CLIENT_ACTION_VERBS as its verb
// whitelist) and a colocated unit test import from here.
import type { DesignState } from './states';

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

