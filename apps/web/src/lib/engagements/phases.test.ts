import { describe, expect, it } from 'vitest';
import { DESIGN_STATES, type DesignState } from './states';
import {
  PHASE_GROUPS,
  PHASE_OF,
  phaseIndex,
  phaseOf,
  type PhaseKey,
} from './phases';

// The one state that belongs to no phase — an off-funnel outcome.
const OFF_FUNNEL: DesignState = 'abandoned';

describe('PHASE_OF', () => {
  it('maps every DesignState (no gap)', () => {
    for (const state of DESIGN_STATES) {
      expect(state in PHASE_OF).toBe(true);
      expect(PHASE_OF[state]).not.toBeUndefined();
    }
  });

  it('maps abandoned to null and nothing else to null', () => {
    for (const state of DESIGN_STATES) {
      if (state === OFF_FUNNEL) {
        expect(PHASE_OF[state]).toBeNull();
      } else {
        expect(PHASE_OF[state]).not.toBeNull();
      }
    }
  });
});

describe('PHASE_GROUPS', () => {
  it('covers exactly DESIGN_STATES minus abandoned, with no duplicate and no gap', () => {
    const mapped = PHASE_GROUPS.flatMap((group) => group.states);
    const expected = DESIGN_STATES.filter((state) => state !== OFF_FUNNEL);

    // No duplicate: a state may appear in only one phase.
    expect(new Set(mapped).size).toBe(mapped.length);
    // Exact set equality (order-independent) with the non-abandoned states.
    expect([...mapped].sort()).toEqual([...expected].sort());
  });

  it('lists the five phases in funnel order', () => {
    expect(PHASE_GROUPS.map((group) => group.key)).toEqual([
      'proposal_survey',
      'concept_layout',
      'threed_approvals',
      'documentation_boq',
      'handoff_execution',
    ]);
  });
});

describe('phaseOf', () => {
  it('returns the phase each state rolls up into', () => {
    expect(phaseOf('created')).toBe('proposal_survey');
    expect(phaseOf('survey')).toBe('proposal_survey');
    expect(phaseOf('layout')).toBe('concept_layout');
    expect(phaseOf('negotiation')).toBe('concept_layout');
    expect(phaseOf('design_3d')).toBe('threed_approvals');
    expect(phaseOf('change_triage')).toBe('threed_approvals');
    expect(phaseOf('boq')).toBe('documentation_boq');
    expect(phaseOf('execution')).toBe('handoff_execution');
    expect(phaseOf('closed_design_only')).toBe('handoff_execution');
  });

  it('returns null for the off-funnel outcome', () => {
    expect(phaseOf('abandoned')).toBeNull();
  });

  it('agrees with PHASE_OF for every state', () => {
    for (const state of DESIGN_STATES) {
      expect(phaseOf(state)).toBe(PHASE_OF[state]);
    }
  });
});

describe('phaseIndex', () => {
  it('gives the 0-based funnel position of each phase', () => {
    const order: PhaseKey[] = [
      'proposal_survey',
      'concept_layout',
      'threed_approvals',
      'documentation_boq',
      'handoff_execution',
    ];
    order.forEach((key, index) => {
      expect(phaseIndex(key)).toBe(index);
    });
  });

  it('is consistent with PHASE_GROUPS ordering', () => {
    PHASE_GROUPS.forEach((group, index) => {
      expect(phaseIndex(group.key)).toBe(index);
    });
  });
});
