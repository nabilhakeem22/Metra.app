// What the portal tells a client who answered the final design, confirmed the
// handover or acknowledged the budget (Round C, carry-over 5). PURE and
// CLIENT-SAFE: the server actions compute it, the page renders it.
//
// THE RULE (B12's, for the concept): the portal only ever confirms a decision
// that is SAVED. A first `ok` saved the tapped verb. A repeat (`already`), a
// review that closed (`wrong_state`) or a delivery that ended (`not_active`)
// saved nothing: the answer is the decision ON FILE, read back from the
// snapshot, which may be the other verb (a stale tab). With nothing on file the
// answer says why: `moved_on` only when the delivery really left the review
// stage, `changed` when it is still there (the studio withdrew a decision, or
// what the client saw is no longer what is issued).
import type { PortalErrorKey } from './portal-error-key';
import type { PortalStageKey } from './portal-stage';
import type { PublicDelivery } from './public/types';

export type DesignOutcome =
  | { kind: 'approved' | 'changes_requested'; studioNotified: boolean; budgetAcknowledged?: boolean }
  | { kind: 'changed' }
  | { kind: 'moved_on' }
  | { kind: 'error'; error: PortalErrorKey };

export type HandoverOutcome =
  | { kind: 'acknowledged'; studioNotified: boolean }
  | { kind: 'changed' }
  | { kind: 'moved_on' }
  | { kind: 'error'; error: PortalErrorKey };

export type BudgetOutcome =
  | { kind: 'acknowledged'; studioNotified: boolean }
  | { kind: 'changed' }
  | { kind: 'error'; error: PortalErrorKey };

/** The two respond verbs of the final design (app_delivery_respond_by_token). */
export const DESIGN_VERBS = ['approve_design', 'request_design_changes'] as const;
export type DesignVerb = (typeof DESIGN_VERBS)[number];

export function isDesignVerb(verb: unknown): verb is DesignVerb {
  return DESIGN_VERBS.some((candidate) => candidate === verb);
}

/** What a FIRST `ok` of each design verb recorded. */
export const OUTCOME_OF_DESIGN_VERB = {
  approve_design: 'approved',
  request_design_changes: 'changes_requested',
} as const satisfies Record<DesignVerb, 'approved' | 'changes_requested'>;

/** A design decision on file, as the act whose notification it is. */
export const ACT_OF_DESIGN_DECISION = {
  approved: 'design_approved',
  changes_requested: 'design_changes_requested',
} as const satisfies Record<NonNullable<PublicDelivery['designDecision']>['kind'], string>;

/** The refusals after which the decision ON FILE is the answer, not an error. */
const SAVED_DECISION_REFUSALS: ReadonlySet<string> = new Set(['wrong_state', 'not_active']);

/** True when a write's refusal means "nothing saved by this tap; ask the snapshot". */
export function answersFromSaved(result: { ok: boolean; code?: string; error?: string }): boolean {
  return result.ok ? result.code === 'already' : SAVED_DECISION_REFUSALS.has(result.error ?? '');
}

/** With nothing on file: still at the review stage reads `changed`, elsewhere `moved_on`. */
export function nothingOnFile(
  saved: Pick<PublicDelivery, 'stageKey'> | null,
  reviewStage: PortalStageKey,
): { kind: 'changed' } | { kind: 'moved_on' } {
  return saved?.stageKey === reviewStage ? { kind: 'changed' } : { kind: 'moved_on' };
}

/** The design decision on file, or why there is none. */
export function designOutcomeOfSaved(
  saved: Pick<PublicDelivery, 'designDecision' | 'stageKey'> | null,
  studioNotified: boolean,
): DesignOutcome {
  const decision = saved?.designDecision ?? null;
  return decision ? { kind: decision.kind, studioNotified } : nothingOnFile(saved, 'finalApproval');
}

/** The handover confirmation on file, or why there is none. */
export function handoverOutcomeOfSaved(
  saved: Pick<PublicDelivery, 'handoverAcknowledgedAt' | 'stageKey'> | null,
  studioNotified: boolean,
): HandoverOutcome {
  return saved?.handoverAcknowledgedAt ? { kind: 'acknowledged', studioNotified } : nothingOnFile(saved, 'handover');
}
