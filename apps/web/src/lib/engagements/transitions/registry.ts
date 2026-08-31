// Design-Engagement Machine — transition registry (Step 2, tail wired, 3D
// revision loop wired). PURE, CLIENT-SAFE DATA: the whole shape of the machine
// declared in one place. All 19 triggers are listed AND all 19 are now wired
// (`WIRED_TRIGGERS`) — the fail-closed `pendingGuard` sentinel is referenced by
// no edge any more.
import type { TransitionDef, Trigger } from './types';

/**
 * The registry. Every trigger is wired (see `WIRED_TRIGGERS`): the happy path
 * runs created -> … -> execution / closed_design_only, `abandon` is the
 * guard-less off-ramp, `rejectDesign` bounces the design back to negotiation,
 * and `designChangeRaised` sends the 3D back for a revision.
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
  // Step 11: the render-baseline edge. `rendersPresent` proves at least one
  // approved render exists; the side-effect captures the deterministic baseline
  // manifest hash over those renders and stamps `renders_ready_at`, atomically
  // with the design_3d -> final_approval move.
  // Client Deliverables (Step 1): the approved renders are released to the portal
  // alongside the manifest capture — a separate field, not a second side-effect.
  rendersReady: {
    from: 'design_3d',
    to: 'final_approval',
    guards: ['rendersPresent'],
    sideEffect: 'captureRenderManifest',
    capability: 'engagements_design',
    clientRelease: 'designPackage',
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
  // `revisionCosSettled` is LAST and mirrors `confirmConcept`: once
  // `designChangeRaised` can raise a priced 3D change order at final_approval /
  // shop_drawings, the return path (rendersReady -> final_approval -> approveDesign)
  // must re-check settlement or that change order could go uncollected while the
  // design is approved. It stays after gateBInstallmentCleared so `moneyGuardOf`
  // still resolves the Gate-B milestone for pay-and-advance.
  approveDesign: {
    from: 'final_approval',
    to: 'shop_drawings',
    guards: [
      'romAcknowledged',
      'asBuiltReconciled',
      'gateBInstallmentCleared',
      'revisionCosSettled',
    ],
    sideEffect: 'recordDesignApproval',
    capability: 'engagements_design',
  },
  // Tail wiring: the drafted shop drawings open the BOQ stage. Pure state move —
  // recording a `shop_drawing` artifact IS the attested deliverable.
  draftReady: {
    from: 'shop_drawings',
    to: 'boq',
    guards: ['shopDrawingsPresent'],
    sideEffect: null,
    capability: 'engagements_design',
  },
  // Tail wiring: a recorded BOQ artifact closes documentation and opens the
  // execution decision. Finance family — the BOQ is priced work.
  finalizeBOQ: {
    from: 'boq',
    to: 'execution_decision',
    guards: ['boqPresent'],
    sideEffect: null,
    capability: 'engagements_finance',
  },
  // Tail wiring (owner-locked): the BALANCE gates BOTH execution-decision exits —
  // the final installment clears before either ending.
  // Client Deliverables (Step 1): the design-only handover releases the shop
  // drawings to the portal. The BOQ is NOT part of this package — it stays
  // manual-only (it can carry the firm's own rates).
  chooseDesignOnly: {
    from: 'execution_decision',
    to: 'design_only_handoff',
    guards: ['balanceCleared'],
    sideEffect: null,
    capability: 'engagements_design',
    clientRelease: 'handoverPackage',
  },
  // Tail wiring: the handoff acknowledgement (client token path OR the staff
  // stand-in) closes the design-only ending. Issue family — owner/admin only.
  recipientAcknowledges: {
    from: 'design_only_handoff',
    to: 'closed_design_only',
    guards: ['handoffAcknowledged'],
    sideEffect: null,
    capability: 'engagements_issue',
  },
  chooseExecution: {
    from: 'execution_decision',
    to: 'execution',
    guards: ['balanceCleared'],
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
  // The 3D revision loop: the client asked for design changes, so the studio
  // pulls the engagement back to design_3d to revise and RE-ISSUE the renders.
  // Guard-less (the requestRevision/rejectDesign precedent — a revision is
  // always allowed while the design is in flight), and it REUSES the concept
  // stage's `applyRevision` side-effect so the commercial rule is one mechanism,
  // not two: N free revisions, then a priced change order (the payload's
  // `changeOrderAmount` is required past the allowance, else the whole
  // transition rolls back with `revision_co_amount_required`).
  designChangeRaised: {
    from: ['final_approval', 'shop_drawings'],
    to: 'design_3d',
    guards: [],
    sideEffect: 'applyRevision',
    capability: 'engagements_design',
  },
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
};

/**
 * Triggers wired for real (their guards are not the fail-closed sentinel). Now
 * the COMPLETE trigger set — nothing routes through `pendingGuard` any more.
 */
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
  'designChangeRaised',
  'draftReady',
  'finalizeBOQ',
  'chooseDesignOnly',
  'chooseExecution',
  'recipientAcknowledges',
  'abandon',
]);
