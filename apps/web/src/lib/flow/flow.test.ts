import { describe, expect, it } from 'vitest';
import { DESIGN_STATES, type DesignState } from '@/lib/engagements/states';
import { FLOWS, type Flow } from '@/lib/entitlements/flows';
import { currentPhaseOf, FLOW_PHASES, phasesOf } from './flow';
import type { EntryPhase } from './types';

describe('the flow registry', () => {
  it('gives every registered flow its phases', () => {
    for (const flow of FLOWS) expect(FLOW_PHASES[flow].length, flow).toBeGreaterThan(0);
    expect(FLOW_PHASES.interior).toEqual(['design', 'execution']);
  });

  it('starts a delivery at the phase it entered at', () => {
    expect(phasesOf('interior', 'design')).toEqual(['design', 'execution']);
    expect(phasesOf('interior', 'execution')).toEqual(['execution']);
  });

  it('refuses a flow or an entry phase it does not know (F8)', () => {
    expect(() => phasesOf('construction' as Flow, 'design')).toThrow(/unknown flow/);
    expect(() => phasesOf('interior', 'handover' as EntryPhase)).toThrow(/has no handover phase/);
  });
});

describe('currentPhaseOf', () => {
  it('is execution only at the execution state, design everywhere else', () => {
    for (const state of DESIGN_STATES) {
      expect(currentPhaseOf(state), state).toBe(state === 'execution' ? 'execution' : 'design');
    }
  });

  it('refuses a state it does not know (F8)', () => {
    expect(() => currentPhaseOf('bogus' as DesignState)).toThrow(/unknown design state/);
  });
});
