// Design-Engagement Machine — transition registry (Step 2). PURE, CLIENT-SAFE
// DATA: the whole shape of the machine declared in one place. All 17 triggers
// are listed so the graph is complete and honest; the wired edges live in
// `WIRED_TRIGGERS` (Step 5: submitDesignFee, confirmAndPayDeposit,
// spatialBaseReady; Step 6: optionsReady; Step 7: selectConcept; Step 8:
// requestRevision self-loop). Every not-yet-wired trigger points its guard at
// `pendingGuard`, which fails closed with `transition_not_yet_enabled` —
// declared, reachable in type-space, but impossible to fire until its real
// guard/side-effect lands.
import type { MilestoneBasis, MilestoneKind } from '@metra/db';
import type { Capability } from '@/lib/permissions/roles';
import type { GuardKey } from './guards';
import type { DesignState } from './states';

/** The 17 lifecycle triggers. Order is documentation, not a contract. */
export type Trigger =
  | 'submitDesignFee'
  | 'confirmAndPayDeposit'
  | 'spatialBaseReady'
  | 'optionsReady'
  | 'selectConcept'
  | 'requestRevision'
  | 'confirmConcept'
  | 'rendersReady'
  | 'approveDesign'
  | 'draftReady'
  | 'finalizeBOQ'
  | 'chooseDesignOnly'
  | 'recipientAcknowledges'
  | 'chooseExecution'
  | 'rejectDesign'
  | 'designChangeRaised'
  | 'abandon';

/** The three capability families that gate engagement triggers (§2.2). */
export type CapabilityKey = Extract<
  Capability,
  'engagements_design' | 'engagements_finance' | 'engagements_issue'
>;

/**
 * Side-effect identifiers. Step 3 wired `generateFeeSchedule` (submitDesignFee);
 * Step 4 adds `activateOnDeposit` (confirmAndPayDeposit); Step 7 adds
 * `recordConceptApproval` (selectConcept); Step 8 adds `applyRevision`
 * (requestRevision self-loop). A side-effect runs
 * INSIDE the executor's tx (atomic with the state move); its executor branch is
 * the ONLY place it may run. Every later side-effect widens this union AND adds a
 * matching executor branch.
 */
export type SideEffectKey =
  | 'generateFeeSchedule'
  | 'activateOnDeposit'
  | 'recordConceptApproval'
  | 'applyRevision';

/** One milestone row in a fee-schedule payload (money as a scale-4 string). */
export interface MilestoneInput {
  kind: MilestoneKind;
  basis: MilestoneBasis;
  value: string;
}

/** Payload for `generateFeeSchedule`: the design fee + its milestone split. */
export interface GenerateFeeSchedulePayload {
  designFee: string;
  milestones: MilestoneInput[];
}

/**
 * Payload for `applyRevision` (requestRevision self-loop). Both fields are
 * optional: a FREE revision needs neither; a revision that crosses the free
 * allowance REQUIRES `changeOrderAmount` (a scale-4 money string > 0) or the whole
 * transition rolls back with `revision_co_amount_required`.
 */
export interface RequestRevisionPayload {
  changeOrderAmount?: string;
  reason?: string;
}

/** Maps each side-effect key to the payload its executor branch requires. */
export interface TriggerPayloads {
  generateFeeSchedule: GenerateFeeSchedulePayload;
  applyRevision: RequestRevisionPayload;
}

export interface TransitionDef {
  from: DesignState | DesignState[];
  to: DesignState;
  guards: GuardKey[];
  sideEffect: SideEffectKey | null;
  capability: CapabilityKey;
}

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
  confirmConcept: {
    from: 'negotiation',
    to: 'design_3d',
    guards: ['pendingGuard'],
    sideEffect: null,
    capability: 'engagements_design',
  },
  rendersReady: {
    from: 'design_3d',
    to: 'final_approval',
    guards: ['pendingGuard'],
    sideEffect: null,
    capability: 'engagements_design',
  },
  approveDesign: {
    from: 'final_approval',
    to: 'shop_drawings',
    guards: ['pendingGuard'],
    sideEffect: null,
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
  rejectDesign: {
    from: 'final_approval',
    to: 'negotiation',
    guards: ['pendingGuard'],
    sideEffect: null,
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
]);
