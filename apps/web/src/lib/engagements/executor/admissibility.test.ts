import { describe, expect, it } from 'vitest';
import { ActionError } from '@/lib/actions/result';
import { TRANSITIONS } from '../transitions';
import type { TransitionDef } from '../transitions';
import { isSelfLoop, legalFromStates, validateLegalFrom } from './admissibility';

// No database, no transaction, no OrgContext: admissibility is decidable from
// the edge definition alone, which is the whole reason it was extracted.
const edge = (def: Partial<TransitionDef>): TransitionDef => ({
  from: 'created',
  to: 'design_proposal',
  guards: [],
  sideEffect: null,
  capability: 'engagements_design',
  ...def,
});

describe('legalFromStates', () => {
  it('normalises a single `from` to a one-element list', () => {
    expect(legalFromStates(edge({ from: 'created' }))).toEqual(['created']);
  });

  it('passes a multi-state `from` through unchanged', () => {
    expect(
      legalFromStates(edge({ from: ['final_approval', 'change_triage'] })),
    ).toEqual(['final_approval', 'change_triage']);
  });
});

describe('isSelfLoop', () => {
  it('is true when the target is the only legal from-state', () => {
    expect(
      isSelfLoop(edge({ from: 'negotiation', to: 'negotiation' })),
    ).toBe(true);
  });

  it('is true PER DEFINITION when the target is one of several from-states', () => {
    expect(
      isSelfLoop(
        edge({ from: ['final_approval', 'change_triage'], to: 'final_approval' }),
      ),
    ).toBe(true);
  });

  it('is false on an advancing edge', () => {
    expect(isSelfLoop(edge({ from: 'created', to: 'design_proposal' }))).toBe(
      false,
    );
  });

  it('agrees with the registry: requestRevision loops, spatialBaseReady advances', () => {
    expect(isSelfLoop(TRANSITIONS.requestRevision)).toBe(true);
    expect(isSelfLoop(TRANSITIONS.attestAsBuiltClean)).toBe(true);
    expect(isSelfLoop(TRANSITIONS.spatialBaseReady)).toBe(false);
  });
});

describe('validateLegalFrom', () => {
  it('returns silently when the state is a legal from', () => {
    expect(() =>
      validateLegalFrom(edge({ from: ['survey', 'layout'] }), 'layout'),
    ).not.toThrow();
  });

  it('fails with illegal_trigger when the state is not a legal from', () => {
    expect(() => validateLegalFrom(edge({ from: 'created' }), 'boq')).toThrow(
      ActionError,
    );
    try {
      validateLegalFrom(edge({ from: 'created' }), 'boq');
    } catch (error) {
      expect((error as ActionError).code).toBe('illegal_trigger');
    }
  });
});
