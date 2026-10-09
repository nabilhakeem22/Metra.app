import { describe, expect, it } from 'vitest';
import ar from '@/messages/ar-EG.json';
import en from '@/messages/en.json';
import { JOURNEY_MILESTONES, stateMilestone } from './journey-map';
import { DESIGN_STATES, type DesignState } from './states';

describe('JOURNEY_MILESTONES', () => {
  it('has the six client-facing milestones in order', () => {
    expect(JOURNEY_MILESTONES).toEqual(['proposal', 'survey', 'concept', 'design', 'documents', 'handover']);
  });

  it('every milestone label is in both catalogs', () => {
    for (const key of JOURNEY_MILESTONES) {
      expect(en.delivery.journey[key].length, `en ${key}`).toBeGreaterThan(0);
      expect(ar.delivery.journey[key].length, `ar ${key}`).toBeGreaterThan(0);
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
    ['final_approval', 3, false, false],
    ['change_triage', 3, false, false],
    ['shop_drawings', 4, false, false],
    ['boq', 4, false, false],
    ['execution_decision', 4, false, false],
    ['design_only_handoff', 5, false, false],
    ['closed_design_only', 6, true, false],
    ['execution', 6, true, false],
    ['abandoned', 0, false, true],
  ];

  it.each(cases)('%s → index %i (allComplete %s, closed %s)', (state, index, allComplete, closed) => {
    const progress = stateMilestone(state);
    expect(progress.index).toBe(index);
    expect(progress.allComplete).toBe(allComplete);
    expect(progress.closed).toBe(closed);
  });

  it('covers all 16 machine states', () => {
    expect(cases.map(([state]) => state).sort()).toEqual([...DESIGN_STATES].sort());
  });

  it('at the final approval the client is at Design, not Handover', () => {
    expect(JOURNEY_MILESTONES[stateMilestone('final_approval').index]).toBe('design');
  });
});
