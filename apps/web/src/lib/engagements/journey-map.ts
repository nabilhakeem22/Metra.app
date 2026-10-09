// Client-portal journey map. PURE and SERVER-SAFE: no `@metra/db` runtime value,
// no 'use client'. Collapses the 16 internal machine states into the SIX
// milestones a homeowner recognises, so the portal can light the client's
// position without ever surfacing a raw machine state name. The milestone
// labels live in the catalogs under `delivery.journey.<key>`.
import type { DesignState } from './states';

/** The six client-facing milestones, in order. */
export const JOURNEY_MILESTONES = [
  'proposal',
  'survey',
  'concept',
  'design',
  'documents',
  'handover',
] as const;

export type JourneyMilestoneKey = (typeof JOURNEY_MILESTONES)[number];

/** Where the client is on the six-milestone journey. */
export interface MilestoneProgress {
  /** 0-based index of the CURRENT milestone (6 = past the last, all complete). */
  index: number;
  /** Every milestone is done (the design is delivered). */
  allComplete: boolean;
  /** The engagement was closed without delivery (abandoned) — render all muted. */
  closed: boolean;
}

function at(index: number): MilestoneProgress {
  return { index, allComplete: false, closed: false };
}

const COMPLETE: MilestoneProgress = { index: JOURNEY_MILESTONES.length, allComplete: true, closed: false };

/**
 * Exhaustive machine-state → journey-milestone map. `tsc` fails if a new
 * `DesignState` is added without a row here (the `Record` is total), so the
 * portal can never fall back to a raw state name.
 *  - Proposal  (0): created, design_proposal
 *  - Survey    (1): survey, layout
 *  - Concept   (2): concept_review, negotiation
 *  - Design    (3): design_3d, final_approval, change_triage
 *  - Drawings and quantities (4): shop_drawings, boq, execution_decision
 *  - Handover  (5): design_only_handoff
 *  - allComplete (6): closed_design_only, execution
 *  - closed:      abandoned
 */
const STATE_MILESTONE: Record<DesignState, MilestoneProgress> = {
  created: at(0),
  design_proposal: at(0),
  survey: at(1),
  layout: at(1),
  concept_review: at(2),
  negotiation: at(2),
  design_3d: at(3),
  final_approval: at(3),
  change_triage: at(3),
  shop_drawings: at(4),
  boq: at(4),
  execution_decision: at(4),
  design_only_handoff: at(5),
  closed_design_only: COMPLETE,
  execution: COMPLETE,
  abandoned: { index: 0, allComplete: false, closed: true },
};

/** Resolve the client's journey position for a machine state. */
export function stateMilestone(state: DesignState): MilestoneProgress {
  return STATE_MILESTONE[state];
}
