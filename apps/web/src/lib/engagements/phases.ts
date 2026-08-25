// Design-Engagement Machine — funnel PHASE metadata (Epic D, Slice 1). PURE and
// CLIENT-SAFE: this module groups the 16 lifecycle states into the 5 cockpit
// phases the reskin renders from. It imports ONLY the `DesignState` type and the
// `DESIGN_STATES` runtime list from the equally-client-safe `states.ts` — no
// runtime `@metra/db` value — so a `'use client'` cockpit component may import it
// directly without turning a DB value into a client-reference proxy (a runtime
// 500 that still passes tsc/build). `DesignState` originates in `states.ts` (it is
// `(typeof DESIGN_STATES)[number]`), NOT in `@metra/db` (whose enum type is
// `DesignEngagementState`), so the type-only import resolves there.
import { DESIGN_STATES, type DesignState } from './states';

/** The five ordered cockpit phases the engagement funnel collapses into. */
export type PhaseKey =
  | 'proposal_survey'
  | 'concept_layout'
  | 'threed_approvals'
  | 'documentation_boq'
  | 'handoff_execution';

/** One phase and the lifecycle states that roll up into it. */
export interface PhaseGroup {
  key: PhaseKey;
  states: readonly DesignState[];
}

// The phase → states grouping, kept as a literal (`as const`) so the compile-time
// drift assertions below can read each state as its exact string, while
// `satisfies` proves every entry conforms to the PhaseGroup shape. `abandoned` is
// deliberately absent — it is an off-funnel outcome that belongs to no phase.
const PHASE_GROUPS_DATA = [
  { key: 'proposal_survey', states: ['created', 'design_proposal', 'survey'] },
  { key: 'concept_layout', states: ['layout', 'concept_review', 'negotiation'] },
  {
    key: 'threed_approvals',
    states: ['design_3d', 'final_approval', 'change_triage'],
  },
  { key: 'documentation_boq', states: ['shop_drawings', 'boq'] },
  {
    key: 'handoff_execution',
    states: [
      'execution_decision',
      'design_only_handoff',
      'closed_design_only',
      'execution',
    ],
  },
] as const satisfies readonly PhaseGroup[];

/** The five phases in funnel order (index 0 = first). */
export const PHASE_GROUPS: readonly PhaseGroup[] = PHASE_GROUPS_DATA;

// ── Compile-time drift guard ────────────────────────────────────────────────
// The union of every state named across PHASE_GROUPS must equal DESIGN_STATES
// minus `abandoned`. Two one-directional assignability checks break `tsc` if a
// state is added/renamed and not mapped (first fails) or a mapped state stops
// being a real non-abandoned DesignState (second fails). Same pattern as the
// enum-parity guard in `states.ts`. Exported so `noUnusedLocals` keeps them.
type AssertExtends<Sub extends Sup, Sup> = Sub;
type MappedState = (typeof PHASE_GROUPS_DATA)[number]['states'][number];
type NonAbandonedState = Exclude<DesignState, 'abandoned'>;
export type _AllStatesMapped = AssertExtends<NonAbandonedState, MappedState>;
export type _NoExtraStatesMapped = AssertExtends<MappedState, NonAbandonedState>;

// PHASE_OF derived from the single source above so it can never drift from
// PHASE_GROUPS. `abandoned` maps to null (in no phase); every other state is
// filled by the loop, and the compile-time guard proves that covers them all.
const phaseOfMutable = {} as Record<DesignState, PhaseKey | null>;
for (const state of DESIGN_STATES) {
  phaseOfMutable[state] = null;
}
for (const group of PHASE_GROUPS_DATA) {
  for (const state of group.states) {
    phaseOfMutable[state] = group.key;
  }
}

/** Every state's phase; `abandoned` (and any future off-funnel state) → null. */
export const PHASE_OF: Record<DesignState, PhaseKey | null> = phaseOfMutable;

/** The phase a state belongs to, or null when it sits off the funnel. */
export function phaseOf(state: DesignState): PhaseKey | null {
  return PHASE_OF[state];
}

/** A phase's 0-based position in funnel order; -1 if the key is unknown. */
export function phaseIndex(key: PhaseKey): number {
  return PHASE_GROUPS.findIndex((group) => group.key === key);
}
