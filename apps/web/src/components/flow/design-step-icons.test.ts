import { describe, expect, it } from 'vitest';
import { JOURNEY_MILESTONES } from '@/lib/engagements/journey-map';
import { DESIGN_PHASE } from '@/lib/flow/phases/design';
import { DESIGN_STAGE_ICON, JOURNEY_STEP_ICON } from './design-step-icons';

describe('the design step icons', () => {
  it.each(JOURNEY_MILESTONES)('the client step %s wears the icon of the first studio stage it groups', (key) => {
    const first = DESIGN_PHASE.steps.find((step) => step.clientStep === key);
    expect(first).toBeDefined();
    expect(JOURNEY_STEP_ICON[key]).toBe(DESIGN_STAGE_ICON[first!.key]);
  });

  it('has an icon for every studio stage of the phase', () => {
    expect(Object.keys(DESIGN_STAGE_ICON).sort()).toEqual(DESIGN_PHASE.steps.map((step) => step.key).sort());
  });
});
