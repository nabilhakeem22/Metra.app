// Design-Engagement Machine — the edges that LEAVE the concept_layout phase
// (`layout`, `concept_review`, `negotiation`; see phases.ts). A trigger is filed
// by the phase of its SOURCE state. This is where the client chooses, revises and
// finally locks a concept. PURE, CLIENT-SAFE DATA.
import type { TransitionDef } from '../types';

export const CONCEPT_LAYOUT_EDGES = {
  // Client Deliverables (Step 1): the concept options the client is asked to choose
  // between — plus the current 2D layout — are released to the portal as the
  // engagement enters concept_review.
  optionsReady: {
    from: 'layout',
    to: 'concept_review',
    guards: ['optionsReady'],
    sideEffect: null,
    capability: 'engagements_design',
    clientRelease: 'conceptPackage',
  },
  selectConcept: {
    from: 'concept_review',
    to: 'negotiation',
    guards: ['gateAInstallmentCleared'],
    sideEffect: 'recordConceptApproval',
    capability: 'engagements_design',
  },
  // SELF-LOOP (Step 8): a revision is always allowed from negotiation (no guard).
  // The side-effect increments the revision counter and — once the count crosses
  // the free allowance — raises a design-fee change order, atomically with the
  // self-loop transition row.
  requestRevision: {
    from: 'negotiation',
    to: 'negotiation',
    guards: [],
    sideEffect: 'applyRevision',
    capability: 'engagements_design',
  },
  // Step 9: the change-order settlement gate. A concept can only lock and exit
  // negotiation once every over-allowance revision change order is covered by
  // cleared revision_co payments (`revisionCosSettled`); the side-effect settles
  // those COs and stamps `concept_locked_at`, atomically with the state move.
  confirmConcept: {
    from: 'negotiation',
    to: 'design_3d',
    guards: ['revisionCosSettled'],
    sideEffect: 'settleConceptAndLock',
    capability: 'engagements_design',
  },
} satisfies Record<string, TransitionDef>;
