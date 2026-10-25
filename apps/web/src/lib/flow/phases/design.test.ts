import { describe, expect, it } from 'vitest';
import { JOURNEY_MILESTONES, stateMilestone } from '@/lib/engagements/journey-map';
import { SPINE_NODES, SPINE_STAGES, spineStageKeyOf } from '@/lib/engagements/stage-spine';
import { DESIGN_STATES, type DesignState } from '@/lib/engagements/states';
import { DESIGN_PHASE } from './design';

/**
 * The one state where the studio and the client name a different place, on
 * purpose: once the BOQ is issued the studio is deciding the handover
 * (`execution_decision` sits on the spine's handover stage), while the client
 * is still shown "drawings and quantities" until a handover is actually offered.
 */
const STUDIO_AHEAD_OF_CLIENT: ReadonlySet<DesignState> = new Set<DesignState>(['execution_decision']);

describe('DESIGN_PHASE', () => {
  it('has the spine stages, in the spine order', () => {
    expect(DESIGN_PHASE.steps.map((step) => step.key)).toEqual([...SPINE_STAGES]);
  });

  it('carries each spine gate on the stage right after it', () => {
    const gateBefore = Object.fromEntries(
      DESIGN_PHASE.steps.filter((step) => step.gateBefore).map((step) => [step.key, step.gateBefore]),
    );
    const expected: Record<string, string> = {};
    SPINE_NODES.forEach((node, index) => {
      if (node.kind === 'gate') expected[SPINE_NODES[index + 1].key] = node.key;
    });
    expect(gateBefore).toEqual(expected);
  });

  it('groups onto the six journey milestones, each once and in the journey order', () => {
    const groups: string[] = [];
    for (const step of DESIGN_PHASE.steps) {
      const group = step.clientStep ?? step.key;
      if (groups[groups.length - 1] !== group) groups.push(group);
    }
    expect(groups).toEqual([...JOURNEY_MILESTONES]);
  });

  it('agrees with the journey map on every live state but the one named above', () => {
    for (const state of DESIGN_STATES) {
      const progress = stateMilestone(state);
      if (progress.closed || progress.allComplete) continue;
      const step = DESIGN_PHASE.steps.find((candidate) => candidate.key === spineStageKeyOf(state));
      const journeyMilestone = JOURNEY_MILESTONES[progress.index];
      if (STUDIO_AHEAD_OF_CLIENT.has(state)) expect(step?.clientStep, state).not.toBe(journeyMilestone);
      else expect(step?.clientStep, state).toBe(journeyMilestone);
    }
  });
});
