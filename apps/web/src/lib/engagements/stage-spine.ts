// The STUDIO's stage spine — the cockpit's "where are we" band. PURE and
// CLIENT-SAFE (the `journey-map.ts` pattern): no db runtime, no 'use client', so
// the command card renders it and a unit test reads it without a React tree.
//
// WHY THIS IS NOT `journey-map.ts`. That map collapses the sixteen machine states
// into five friendly milestones — Proposal, Survey, Concept, 3D, Handover — for a
// HOMEOWNER, and it deliberately hides the gates: a client should never be shown
// the machine. The cockpit was rendering that same ribbon, which meant a studio
// looked at its own engagement through the client's simplification and could not
// see Gate A or Gate B anywhere on the page. The gates are the model the whole
// product runs on. Two audiences, two objects.
//
// THE GATES ARE NODES, NOT DECORATION. A gate sits BETWEEN two stages because
// that is literally where it is: `selectConcept` cannot fire until the Gate-A
// instalment clears, and `approveDesign` cannot fire until the cost range is
// acknowledged and the Gate-B instalment clears. Drawing them inline is what
// makes the spine explain the workflow instead of just tracking it.
//
// `final_approval` has no stage of its own here on purpose — it IS Gate B. It is
// the state the engagement waits in while the gate's four guards are worked
// through, so giving it a segment beside the gate marker would draw the same
// thing twice. `change_triage` is a detour off it and sits at the same marker.
import type { DesignState } from './states';

/** A stage the studio works IN, or a gate it has to get THROUGH. */
export type SpineNode =
  | { kind: 'stage'; key: SpineStageKey }
  | { kind: 'gate'; key: SpineGateKey };

export type SpineStageKey =
  | 'proposal'
  | 'survey'
  | 'layout'
  | 'concept'
  | 'threeD'
  | 'shopDrawings'
  | 'boq'
  | 'handover';

export type SpineGateKey = 'gateA' | 'gateB';

/**
 * The spine, in order. Gate A separates the concept from the 3D work; Gate B
 * separates the design from the drawings that build it.
 */
export const SPINE_NODES: readonly SpineNode[] = [
  { kind: 'stage', key: 'proposal' },
  { kind: 'stage', key: 'survey' },
  { kind: 'stage', key: 'layout' },
  { kind: 'stage', key: 'concept' },
  { kind: 'gate', key: 'gateA' },
  { kind: 'stage', key: 'threeD' },
  { kind: 'gate', key: 'gateB' },
  { kind: 'stage', key: 'shopDrawings' },
  { kind: 'stage', key: 'boq' },
  { kind: 'stage', key: 'handover' },
] as const;

/** Just the stages, in order — the spine's measurable progress. */
export const SPINE_STAGES: readonly SpineStageKey[] = SPINE_NODES.filter(
  (n): n is { kind: 'stage'; key: SpineStageKey } => n.kind === 'stage',
).map((n) => n.key);

/**
 * Exhaustive state → stage map. The `Record` is total, so `tsc` fails if a new
 * `DesignState` lands without a home here and the spine can never fall through to
 * a blank segment.
 *
 * `final_approval` and `change_triage` map to `threeD`: the design work is done
 * and the engagement is sitting AT Gate B, so the last lit stage is the 3D one
 * and the gate marker after it carries the attention. `abandoned` maps to
 * `proposal` and is only ever read alongside `closed`, which mutes the whole row.
 */
const STATE_STAGE: Record<DesignState, SpineStageKey> = {
  created: 'proposal',
  design_proposal: 'proposal',
  survey: 'survey',
  layout: 'layout',
  concept_review: 'concept',
  negotiation: 'concept',
  design_3d: 'threeD',
  final_approval: 'threeD',
  change_triage: 'threeD',
  shop_drawings: 'shopDrawings',
  boq: 'boq',
  execution_decision: 'handover',
  design_only_handoff: 'handover',
  closed_design_only: 'handover',
  execution: 'handover',
  abandoned: 'proposal',
};

/** Where the studio is on the spine. */
export interface SpinePosition {
  /** 0-based index into `SPINE_STAGES`. */
  index: number;
  /** Every stage is behind us — the engagement reached a terminal outcome. */
  allComplete: boolean;
  /** Abandoned: render the whole row muted, no stage is "current". */
  closed: boolean;
  /** The gate the engagement is waiting at, or null. */
  atGate: SpineGateKey | null;
}

/**
 * The states that sit AT a gate rather than in the stage before it. Being at a
 * gate is what the marker highlights — it is the difference between "the 3D work
 * is in progress" and "the 3D is done and the client owes us an approval".
 */
const STATE_GATE: Partial<Record<DesignState, SpineGateKey>> = {
  concept_review: 'gateA',
  // `negotiation` is NOT at Gate A, and marking it there was a real bug: the only
  // edge into it from before the gate is `selectConcept`, whose sole guard IS
  // `gateAInstallmentCleared`. Being in this state therefore PROVES the instalment
  // cleared, and payments are append-only so it stays cleared. The spine was
  // flagging the money as outstanding in warn colour while the checklist an inch
  // below correctly showed the only unmet guard was `revisionCosSettled`.
  final_approval: 'gateB',
  // `change_triage` DOES still owe Gate B — it is a detour off `final_approval`
  // and rejoins it, so `approveDesign`'s guards are still ahead of it.
  change_triage: 'gateB',
};

/** Resolve the studio's spine position for a machine state. */
export function spinePosition(state: DesignState): SpinePosition {
  const closed = state === 'abandoned';
  const allComplete = state === 'closed_design_only' || state === 'execution';
  return {
    index: SPINE_STAGES.indexOf(STATE_STAGE[state]),
    allComplete,
    closed,
    atGate: closed || allComplete ? null : (STATE_GATE[state] ?? null),
  };
}
