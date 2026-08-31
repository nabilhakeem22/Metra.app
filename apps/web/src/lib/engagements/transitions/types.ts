// Design-Engagement Machine — transition contract types (Step 2). PURE, CLIENT-SAFE
// type-space: the triggers, capability families, side-effect keys, and payloads
// that describe the shape of every edge. The concrete edge table lives in
// `./registry`; these are the types it is declared against.
import type { MilestoneBasis, MilestoneKind } from '@metra/db';
import type { Capability } from '@/lib/permissions/roles';
import type { ClientReleaseKey } from '../client-release';
import type { GuardKey } from '../guards';
import type { DesignState } from '../states';

/** The 19 lifecycle triggers. Order is documentation, not a contract. */
export type Trigger =
  | 'submitDesignFee'
  | 'confirmAndPayDeposit'
  | 'spatialBaseReady'
  | 'optionsReady'
  | 'selectConcept'
  | 'requestRevision'
  | 'confirmConcept'
  | 'rendersReady'
  | 'flagAsBuiltVariance'
  | 'attestAsBuiltClean'
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
 * (requestRevision self-loop); Step 9 adds `settleConceptAndLock` (confirmConcept);
 * Step 11 adds `captureRenderManifest` (rendersReady); Step 13 adds
 * `recordAsBuiltVariance` (flagAsBuiltVariance) and `recordAsBuiltClean`
 * (attestAsBuiltClean), each appending one `as_built_attestation` event; Step 14
 * adds `recordDesignApproval` (approveDesign, appending one `design_approval`
 * event) and `resetRevisionsOnReject` (rejectDesign, refilling the free-revision
 * allowance). `applyRevision` is now SHARED: `designChangeRaised` (the 3D
 * revision loop) reuses it so both revision edges price revisions by one rule —
 * against two INDEPENDENT counters (the firing trigger picks its own pair).
 * A side-effect runs INSIDE the executor's tx (atomic with the state move); its
 * executor branch is the ONLY place it may run. Every later side-effect widens
 * this union AND adds a matching executor branch.
 */
export type SideEffectKey =
  | 'generateFeeSchedule'
  | 'activateOnDeposit'
  | 'recordConceptApproval'
  | 'applyRevision'
  | 'settleConceptAndLock'
  | 'captureRenderManifest'
  | 'recordAsBuiltVariance'
  | 'recordAsBuiltClean'
  | 'recordDesignApproval'
  | 'resetRevisionsOnReject';

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
 * Payload for `applyRevision` — carried by BOTH revision edges: the
 * `requestRevision` concept self-loop and the `designChangeRaised` 3D revision
 * loop. Both fields are optional: a FREE revision needs neither; a revision that
 * crosses the free allowance REQUIRES `changeOrderAmount` (a scale-4 money
 * string > 0) or the whole transition rolls back with
 * `revision_co_amount_required`.
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
  /**
   * Client Deliverables, Step 1 — the deliverable package this edge releases to
   * the client portal. Deliberately a SEPARATE field from `sideEffect`: an edge
   * (e.g. `rendersReady`) can carry both, and the executor applies the release in
   * its own branch inside the same transaction, after the atomic gate. Absent on
   * every edge that shares nothing.
   */
  clientRelease?: ClientReleaseKey;
}
