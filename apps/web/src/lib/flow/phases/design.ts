// The DESIGN phase, derived from the studio's stage spine
// (lib/engagements/stage-spine.ts): the same stages in the same order, each gate
// carried by the stage after it. PURE and CLIENT-SAFE. The spine stays the one
// list of design stages; this file only says how each one groups for the client
// (the six journey milestones of lib/engagements/journey-map.ts). A unit test
// pins that grouping against the journey map, so neither can drift.
import type { JourneyMilestoneKey } from '@/lib/engagements/journey-map';
import { SPINE_NODES, type SpineStageKey } from '@/lib/engagements/stage-spine';
import type { GateKey, PhaseDefinition, StepDefinition } from '../types';

/** The journey milestone each studio stage shows as on the client's page. */
const CLIENT_MILESTONE: Readonly<Record<SpineStageKey, JourneyMilestoneKey>> = {
  proposal: 'proposal',
  survey: 'survey',
  layout: 'survey',
  concept: 'concept',
  threeD: 'design',
  shopDrawings: 'documents',
  boq: 'documents',
  handover: 'handover',
};

/** Every design stage is the studio's own work; the client's moves sit at the gates and reviews. */
function designSteps(): StepDefinition<SpineStageKey>[] {
  const steps: StepDefinition<SpineStageKey>[] = [];
  let gate: GateKey | null = null;
  for (const node of SPINE_NODES) {
    if (node.kind === 'gate') {
      gate = node.key;
      continue;
    }
    steps.push({
      key: node.key,
      defaultActor: 'studio',
      clientStep: CLIENT_MILESTONE[node.key],
      ...(gate ? { gateBefore: gate } : {}),
    });
    gate = null;
  }
  return steps;
}

export const DESIGN_PHASE: PhaseDefinition<SpineStageKey> = { key: 'design', steps: designSteps() };
