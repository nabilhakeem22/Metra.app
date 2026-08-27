// Client-portal (P2 redesign) journey map. PURE and SERVER-SAFE: no `@metra/db`
// runtime value, no 'use client'. Collapses the 16 internal machine states into
// the FIVE friendly milestones a homeowner recognises — Proposal, Survey, Concept,
// 3D, Handover — so the portal can light the client's position without ever
// surfacing a raw machine state name. Mirrors `portal-labels.ts`.
import type { DesignState } from './states';

/** A friendly milestone the client sees on the journey tracker. */
export interface JourneyMilestone {
  key: string;
  label: { en: string; ar: string };
}

/**
 * The five client-facing milestones, in order. `index` in `stateMilestone` is a
 * 0-based position into THIS array (0 = Proposal … 4 = Handover; 5 = past the end,
 * i.e. all complete). The labels are mirrored in the `delivery.journey.*` message
 * catalog for the view; kept here too so the pure map + its test are self-contained.
 */
export const JOURNEY_MILESTONES: readonly JourneyMilestone[] = [
  { key: 'proposal', label: { en: 'Proposal', ar: 'العرض' } },
  { key: 'survey', label: { en: 'Survey', ar: 'المعاينة' } },
  { key: 'concept', label: { en: 'Concept', ar: 'التصميم المبدئي' } },
  { key: 'threeD', label: { en: '3D visuals', ar: 'التصور ثلاثي الأبعاد' } },
  { key: 'handover', label: { en: 'Handover', ar: 'التسليم' } },
] as const;

/** Where the client is on the five-milestone journey. */
export interface MilestoneProgress {
  /** 0-based index of the CURRENT milestone (5 = past the last, all complete). */
  index: number;
  /** Every milestone is done (the design is delivered). */
  allComplete: boolean;
  /** The engagement was closed without delivery (abandoned) — render all muted. */
  closed: boolean;
}

/**
 * Exhaustive machine-state → journey-milestone map. `tsc` fails if a new
 * `DesignState` is added without a row here (the `Record` is total), so the portal
 * can never fall back to a raw state name. Groupings (owner-approved table):
 *  - Proposal  (0): created, design_proposal
 *  - Survey    (1): survey, layout
 *  - Concept   (2): concept_review, negotiation
 *  - 3D        (3): design_3d
 *  - Handover  (4): final_approval, change_triage, shop_drawings, boq,
 *                   execution_decision, design_only_handoff
 *  - allComplete (5): closed_design_only, execution
 *  - closed:      abandoned
 */
const STATE_MILESTONE: Record<DesignState, MilestoneProgress> = {
  created: { index: 0, allComplete: false, closed: false },
  design_proposal: { index: 0, allComplete: false, closed: false },
  survey: { index: 1, allComplete: false, closed: false },
  layout: { index: 1, allComplete: false, closed: false },
  concept_review: { index: 2, allComplete: false, closed: false },
  negotiation: { index: 2, allComplete: false, closed: false },
  design_3d: { index: 3, allComplete: false, closed: false },
  final_approval: { index: 4, allComplete: false, closed: false },
  change_triage: { index: 4, allComplete: false, closed: false },
  shop_drawings: { index: 4, allComplete: false, closed: false },
  boq: { index: 4, allComplete: false, closed: false },
  execution_decision: { index: 4, allComplete: false, closed: false },
  design_only_handoff: { index: 4, allComplete: false, closed: false },
  closed_design_only: { index: 5, allComplete: true, closed: false },
  execution: { index: 5, allComplete: true, closed: false },
  abandoned: { index: 0, allComplete: false, closed: true },
};

/** Resolve the client's journey position for a machine state. */
export function stateMilestone(state: DesignState): MilestoneProgress {
  return STATE_MILESTONE[state];
}
