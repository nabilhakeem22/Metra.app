// The client portal's stage vocabulary. PURE and CLIENT-SAFE: no `@metra/db`
// runtime value, no 'use client'. Every machine state maps to ONE client word,
// and the words themselves (a label and a calm note per stage) live in the
// message catalogs under `delivery.stage.<key>`, so the i18n gate checks them
// like any other client copy (parity, no dash, Latin digits, the فصحى register).
//
// A stage key is a CLIENT word and never equals a machine state name, so a
// stage key in the browser payload can never be mistaken for a leaked state.
// The `Record` is total over `DesignState`: a new state fails `tsc` until it is
// given a stage here.
import type { DesignState } from './states';

export const PORTAL_STAGE_KEYS = [
  'gettingStarted',
  'proposalReady',
  'measuring',
  'spacePlanning',
  'conceptReview',
  'refiningConcept',
  'visuals',
  'finalApproval',
  'reviewingChanges',
  'drawings',
  'quantities',
  'nextSteps',
  'handover',
  'delivered',
  'construction',
  'closed',
] as const;

export type PortalStageKey = (typeof PORTAL_STAGE_KEYS)[number];

export const PORTAL_STAGE_KEY: Record<DesignState, PortalStageKey> = {
  created: 'gettingStarted',
  design_proposal: 'proposalReady',
  survey: 'measuring',
  layout: 'spacePlanning',
  concept_review: 'conceptReview',
  negotiation: 'refiningConcept',
  design_3d: 'visuals',
  final_approval: 'finalApproval',
  change_triage: 'reviewingChanges',
  shop_drawings: 'drawings',
  boq: 'quantities',
  execution_decision: 'nextSteps',
  design_only_handoff: 'handover',
  closed_design_only: 'delivered',
  execution: 'construction',
  abandoned: 'closed',
};
