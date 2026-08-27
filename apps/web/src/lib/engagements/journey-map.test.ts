import { describe, expect, it } from 'vitest';
import { JOURNEY_MILESTONES, stateMilestone } from './journey-map';
import { DESIGN_STATES, type DesignState } from './states';

describe('JOURNEY_MILESTONES', () => {
  it('has the five client-facing milestones in order', () => {
    expect(JOURNEY_MILESTONES.map((m) => m.key)).toEqual([
      'proposal',
      'survey',
      'concept',
      'threeD',
      'handover',
    ]);
  });

  it('carries both locales for every milestone', () => {
    for (const milestone of JOURNEY_MILESTONES) {
      expect(milestone.label.en.length).toBeGreaterThan(0);
      expect(milestone.label.ar.length).toBeGreaterThan(0);
    }
  });
});

describe('stateMilestone', () => {
  const cases: Array<[DesignState, number, boolean, boolean]> = [
    // state, index, allComplete, closed
    ['created', 0, false, false],
    ['design_proposal', 0, false, false],
    ['survey', 1, false, false],
    ['layout', 1, false, false],
    ['concept_review', 2, false, false],
    ['negotiation', 2, false, false],
    ['design_3d', 3, false, false],
    ['final_approval', 4, false, false],
    ['change_triage', 4, false, false],
    ['shop_drawings', 4, false, false],
    ['boq', 4, false, false],
    ['execution_decision', 4, false, false],
    ['design_only_handoff', 4, false, false],
    ['closed_design_only', 5, true, false],
    ['execution', 5, true, false],
    ['abandoned', 0, false, true],
  ];

  it.each(cases)('%s → index %i (allComplete %s, closed %s)', (state, index, allComplete, closed) => {
    const progress = stateMilestone(state);
    expect(progress.index).toBe(index);
    expect(progress.allComplete).toBe(allComplete);
    expect(progress.closed).toBe(closed);
  });

  it('covers every machine state (exhaustive)', () => {
    for (const state of DESIGN_STATES) {
      expect(() => stateMilestone(state)).not.toThrow();
      const progress = stateMilestone(state);
      expect(progress.index).toBeGreaterThanOrEqual(0);
      expect(progress.index).toBeLessThanOrEqual(5);
    }
  });
});
