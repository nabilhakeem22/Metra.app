// Design-Engagement Machine — the edges that LEAVE the threed_approvals phase
// (`design_3d`, `final_approval`, `change_triage`; see phases.ts). A trigger is
// filed by the phase of its SOURCE state, which is why the 3D revision loop and
// the Gate-B rejection live here and not with the concept stage they return to.
// PURE, CLIENT-SAFE DATA.
import type { TransitionDef } from '../types';

export const THREED_APPROVAL_EDGES = {
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
  // transition rolls back with `revision_co_amount_required`). It spends its OWN
  // allowance (`design_revision_count` / `free_design_revision_n`), so burning
  // the concept revisions never costs the client a free 3D revision.
  designChangeRaised: {
    from: ['final_approval', 'shop_drawings'],
    to: 'design_3d',
    guards: [],
    sideEffect: 'applyRevision',
    capability: 'engagements_design',
  },
} satisfies Record<string, TransitionDef>;
