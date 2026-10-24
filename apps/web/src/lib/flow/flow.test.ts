import { describe, expect, it } from 'vitest';
import { FLOWS } from '@/lib/entitlements/flows';
import { DESIGN_STATES } from '@/lib/engagements/states';
import { currentPhaseOf, FLOW_PHASES, phasesOf } from './flow';

describe('the flow registry', () => {
  it('gives every registered flow its phases', () => {
    for (const flow of FLOWS) expect(FLOW_PHASES[flow].length, flow).toBeGreaterThan(0);
    expect(FLOW_PHASES.interior).toEqual(['design', 'execution']);
  });

  it('starts a delivery at the phase it entered at', () => {
    expect(phasesOf('interior', 'design')).toEqual(['design', 'execution']);
    expect(phasesOf('interior', 'execution')).toEqual(['execution']);
  });
});

describe('currentPhaseOf', () => {
  it('is execution only at the execution state, design everywhere else', () => {
    for (const state of DESIGN_STATES) {
      expect(currentPhaseOf(state), state).toBe(state === 'execution' ? 'execution' : 'design');
    }
  });
});
