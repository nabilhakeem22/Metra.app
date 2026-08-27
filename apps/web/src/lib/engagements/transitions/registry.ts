// Design-Engagement Machine — transition registry (Step 2). PURE, CLIENT-SAFE
// DATA: the whole shape of the machine declared in one place. All 17 triggers
// are listed so the graph is complete and honest; the wired edges live in
// `WIRED_TRIGGERS` (Step 5: submitDesignFee, confirmAndPayDeposit,
// spatialBaseReady; Step 6: optionsReady; Step 7: selectConcept; Step 8:
// requestRevision self-loop). Every not-yet-wired trigger points its guard at
// `pendingGuard`, which fails closed with `transition_not_yet_enabled` —
// declared, reachable in type-space, but impossible to fire until its real
// guard/side-effect lands.
import type { TransitionDef, Trigger } from './types';

/**
 * The registry. The wired edges (see `WIRED_TRIGGERS`) are `submitDesignFee`
 * (created -> design_proposal), `confirmAndPayDeposit` (design_proposal ->
 * survey), `spatialBaseReady` (survey -> layout), `optionsReady` (layout ->
 * concept_review), `selectConcept` (concept_review -> negotiation) and
 * `requestRevision` (negotiation -> negotiation, a self-loop). Every other
 * trigger is declared with its intended from/to but guarded by `pendingGuard`
 * (fail-closed) until its step arrives.
 */
export const TRANSITIONS: Record<Trigger, TransitionDef> = {
  submitDesignFee: {
    from: 'created',
    to: 'design_proposal',
    guards: ['scopeInputsPresent'],
    sideEffect: 'generateFeeSchedule',
    capability: 'engagements_design',
  },
  confirmAndPayDeposit: {
    from: 'design_proposal',
    to: 'survey',
    guards: ['depositCleared'],
    sideEffect: 'activateOnDeposit',
    capability: 'engagements_finance',
  },
  spatialBaseReady: {
    from: 'survey',
    to: 'layout',
    guards: ['spatialBaseReady'],
    sideEffect: null,
    capability: 'engagements_design',
  },
  optionsReady: {
    from: 'layout',
    to: 'concept_review',
    guards: ['optionsReady'],
    sideEffect: null,
    capability: 'engagements_design',
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
  // Step 11: the render-baseline edge. `rendersPresent` proves at least one
  // approved render exists; the side-effect captures the deterministic baseline
  // manifest hash over those renders and stamps `renders_ready_at`, atomically
  // with the design_3d -> final_approval move.
  rendersReady: {
    from: 'design_3d',
    to: 'final_approval',
    guards: ['rendersPresent'],
    sideEffect: 'captureRenderManifest',
    capability: 'engagements_design',
  },
  // Step 13: the Gate-B as-built variance detour. Only an Off-Plan engagement whose
  // as-built drawings are due (`asBuiltDueOpen`) can flag a variance; the side-effect
  // appends one `as_built_attestation` event with has_variance=true, atomically with
  // the final_approval -> change_triage move.
  flagAsBuiltVariance: {
    from: 'final_approval',
    to: 'change_triage',
    guards: ['asBuiltDueOpen'],
    sideEffect: 'recordAsBuiltVariance',
    capability: 'engagements_design',
  },
  // Step 13: the clean as-built attestation. ONE trigger serves both the
  // final_approval self-loop AND the change_triage -> final_approval reconciliation
  // (both target final_approval — the requestRevision self-loop precedent). The
  // side-effect appends one `as_built_attestation` event with has_variance=false.
  attestAsBuiltClean: {
    from: ['final_approval', 'change_triage'],
    to: 'final_approval',
    guards: ['asBuiltDueOpen'],
    sideEffect: 'recordAsBuiltClean',
    capability: 'engagements_design',
  },
  // Step 14 (Gate B): the design phase closes. The client ROM ack and (for
  // Off-Plan) the as-built reconciliation surface BEFORE money — so the guard order
  // is romAcknowledged -> asBuiltReconciled -> gateBInstallmentCleared. The
  // side-effect appends ONE `design_approval` event, atomic with the state move.
  approveDesign: {
    from: 'final_approval',
    to: 'shop_drawings',
    guards: ['romAcknowledged', 'asBuiltReconciled', 'gateBInstallmentCleared'],
    sideEffect: 'recordDesignApproval',
    capability: 'engagements_design',
  },
  draftReady: {
    from: 'shop_drawings',
    to: 'boq',
    guards: ['pendingGuard'],
    sideEffect: null,
    capability: 'engagements_design',
  },
  finalizeBOQ: {
    from: 'boq',
    to: 'execution_decision',
    guards: ['pendingGuard'],
    sideEffect: null,
    capability: 'engagements_finance',
  },
  chooseDesignOnly: {
    from: 'execution_decision',
    to: 'design_only_handoff',
    guards: ['pendingGuard'],
    sideEffect: null,
    capability: 'engagements_design',
  },
  recipientAcknowledges: {
    from: 'design_only_handoff',
    to: 'closed_design_only',
    guards: ['pendingGuard'],
    sideEffect: null,
    capability: 'engagements_issue',
  },
  chooseExecution: {
    from: 'execution_decision',
    to: 'execution',
    guards: ['pendingGuard'],
    sideEffect: null,
    capability: 'engagements_design',
  },
  // Step 14 (Gate B): bounce the design back to negotiation. No guard — a rejection
  // is always allowed from final_approval. The side-effect RESETS revision_count to
  // 0 (owner-locked: refill free revisions) and reopens the concept lock, atomic
  // with the final_approval -> negotiation move.
  rejectDesign: {
    from: 'final_approval',
    to: 'negotiation',
    guards: [],
    sideEffect: 'resetRevisionsOnReject',
    capability: 'engagements_design',
  },
  designChangeRaised: {
    from: ['final_approval', 'shop_drawings'],
    to: 'design_3d',
    guards: ['pendingGuard'],
    sideEffect: null,
    capability: 'engagements_design',
  },
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
    guards: ['pendingGuard'],
    sideEffect: null,
    capability: 'engagements_design',
  },
};

/** Triggers wired for real (their guards are not the fail-closed sentinel). */
export const WIRED_TRIGGERS: ReadonlySet<Trigger> = new Set<Trigger>([
  'submitDesignFee',
  'confirmAndPayDeposit',
  'spatialBaseReady',
  'optionsReady',
  'selectConcept',
  'requestRevision',
  'confirmConcept',
  'rendersReady',
  'flagAsBuiltVariance',
  'attestAsBuiltClean',
  'approveDesign',
  'rejectDesign',
]);
