// Design-Engagement Machine — the OFF-RAMP. `abandon` belongs to no phase: it
// leaves every non-terminal state at once, which is exactly why it gets its own
// file instead of being filed under the phase of a source state it does not have.
// PURE, CLIENT-SAFE DATA.
import type { TransitionDef } from '../types';

export const OFF_RAMP_EDGES = {
  // Tail wiring: the guard-less off-ramp from every non-terminal state (the UI
  // gates it behind an inline confirm). requestRevision/rejectDesign precedent —
  // abandoning is always allowed while the engagement is in flight.
  abandon: {
    from: [
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
      'change_triage',
    ],
    to: 'abandoned',
    guards: [],
    sideEffect: null,
    capability: 'engagements_design',
  },
} satisfies Record<string, TransitionDef>;
