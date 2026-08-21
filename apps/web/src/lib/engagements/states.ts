// Design-Engagement Machine — state vocabulary (Step 2). PURE and CLIENT-SAFE:
// no DB import, no 'use client'. A UI progress indicator, a server action and a
// unit test all import from here, so this module must never pull a runtime
// `@metra/db` value. The `import type` below is fully erased at compile time — it
// only pins this list to the Postgres `design_engagement_state` enum so the two
// can never silently drift.
import type { DesignEngagementState } from '@metra/db';

/**
 * The 15 engagement states, in lifecycle order. Mirrors the Postgres
 * `design_engagement_state` enum verbatim (the `assertEnumParity` guard below
 * fails the build if they diverge). `created` is the entry state; the three
 * TERMINAL states are the only off-ramps.
 */
export const DESIGN_STATES = [
  'created',
  'design_proposal',
  'survey',
  'layout',
  'concept_review',
  'negotiation',
  'design_3d',
  'final_approval',
  'shop_drawings',
  'boq',
  'execution_decision',
  'design_only_handoff',
  'closed_design_only',
  'execution',
  'abandoned',
] as const;

export type DesignState = (typeof DESIGN_STATES)[number];

// Compile-time proof that DESIGN_STATES stays a permutation of the DB enum: each
// side must be assignable to the other. If Step-N adds an enum value without
// updating this list (or vice-versa), one of these one-directional assertions
// fails `tsc`.
type AssertExtends<Sub extends Sup, Sup> = Sub;
export type _StatesCoverDbEnum = AssertExtends<DesignState, DesignEngagementState>;
export type _DbEnumCoversStates = AssertExtends<DesignEngagementState, DesignState>;

/**
 * Funnel stage number for progress display. The happy path is monotonic
 * (created=1 … execution=14); `abandoned` is off the funnel (0). Terminal
 * outcomes `closed_design_only` (13) and `execution` (14) sit at the tail. This
 * is a presentation aid only — the executor never reads it.
 */
export const STAGE_NUMBER: Record<DesignState, number> = {
  created: 1,
  design_proposal: 2,
  survey: 3,
  layout: 4,
  concept_review: 5,
  negotiation: 6,
  design_3d: 7,
  final_approval: 8,
  shop_drawings: 9,
  boq: 10,
  execution_decision: 11,
  design_only_handoff: 12,
  closed_design_only: 13,
  execution: 14,
  abandoned: 0,
};

/** The three terminal states — no trigger leaves them. */
export const TERMINAL_STATES = new Set<DesignState>([
  'closed_design_only',
  'execution',
  'abandoned',
]);

/** Every non-terminal state (the engagement is still in flight). */
export const ACTIVE_STATES = new Set<DesignState>(
  DESIGN_STATES.filter((state) => !TERMINAL_STATES.has(state)),
);

export function isTerminal(state: DesignState): boolean {
  return TERMINAL_STATES.has(state);
}

export function isActive(state: DesignState): boolean {
  return ACTIVE_STATES.has(state);
}
