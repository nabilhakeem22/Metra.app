import { describe, expect, it } from 'vitest';
import {
  isRevisionTrigger,
  revisionAllowanceFor,
  revisionAmountRequired,
  type RevisionAllowances,
} from './revision-allowance';
import { TRANSITIONS, type Trigger } from './transitions';

/** An engagement that has burned every free CONCEPT revision and no 3D one. */
const CONCEPT_BURNED: RevisionAllowances = {
  revisionCount: 3,
  freeRevisionN: 3,
  designRevisionCount: 0,
  freeDesignRevisionN: 3,
};

describe('isRevisionTrigger', () => {
  it('accepts exactly the two revision edges', () => {
    expect(isRevisionTrigger('requestRevision')).toBe(true);
    expect(isRevisionTrigger('designChangeRaised')).toBe(true);
  });

  it('rejects every other trigger, and unknown strings', () => {
    expect(isRevisionTrigger('confirmConcept')).toBe(false);
    expect(isRevisionTrigger('rejectDesign')).toBe(false);
    expect(isRevisionTrigger('')).toBe(false);
    expect(isRevisionTrigger('applyRevision')).toBe(false);
  });

  it('matches the registry exactly — every applyRevision edge, and only those', () => {
    // The executor narrows `input.trigger` with this guard before it can pick a
    // counter pair, so a THIRD edge wired to `applyRevision` without being named
    // here would fail closed at runtime. Fail here instead, by name.
    const applyRevisionEdges = (Object.keys(TRANSITIONS) as Trigger[]).filter(
      (trigger) => TRANSITIONS[trigger].sideEffect === 'applyRevision',
    );
    expect(applyRevisionEdges.every(isRevisionTrigger)).toBe(true);
    expect(applyRevisionEdges.sort()).toEqual(
      ['designChangeRaised', 'requestRevision'].sort(),
    );
  });
});

describe('revisionAllowanceFor', () => {
  it('gives requestRevision the CONCEPT pair', () => {
    expect(revisionAllowanceFor('requestRevision', CONCEPT_BURNED)).toEqual({
      count: 3,
      free: 3,
    });
  });

  it('gives designChangeRaised the DESIGN pair', () => {
    expect(revisionAllowanceFor('designChangeRaised', CONCEPT_BURNED)).toEqual({
      count: 0,
      free: 3,
    });
  });

  it('reads the two pairs independently', () => {
    const mixed: RevisionAllowances = {
      revisionCount: 1,
      freeRevisionN: 3,
      designRevisionCount: 5,
      freeDesignRevisionN: 4,
    };
    expect(revisionAllowanceFor('requestRevision', mixed)).toEqual({
      count: 1,
      free: 3,
    });
    expect(revisionAllowanceFor('designChangeRaised', mixed)).toEqual({
      count: 5,
      free: 4,
    });
  });
});

describe('revisionAmountRequired', () => {
  it('a fully-burned CONCEPT allowance does NOT price the first 3D revision', () => {
    // The exact bug the independent allowance fixes: with one shared counter this
    // read `true` and the client was charged for their first 3D revision.
    expect(revisionAmountRequired('designChangeRaised', CONCEPT_BURNED)).toBe(false);
    expect(revisionAmountRequired('requestRevision', CONCEPT_BURNED)).toBe(true);
  });

  it('is false inside the allowance and true from the edge onward', () => {
    const at = (designRevisionCount: number): RevisionAllowances => ({
      revisionCount: 0,
      freeRevisionN: 3,
      designRevisionCount,
      freeDesignRevisionN: 3,
    });
    expect(revisionAmountRequired('designChangeRaised', at(0))).toBe(false);
    expect(revisionAmountRequired('designChangeRaised', at(2))).toBe(false);
    expect(revisionAmountRequired('designChangeRaised', at(3))).toBe(true);
    expect(revisionAmountRequired('designChangeRaised', at(4))).toBe(true);
  });

  it('a zero allowance prices the FIRST revision on that edge', () => {
    const none: RevisionAllowances = {
      revisionCount: 0,
      freeRevisionN: 0,
      designRevisionCount: 0,
      freeDesignRevisionN: 0,
    };
    expect(revisionAmountRequired('requestRevision', none)).toBe(true);
    expect(revisionAmountRequired('designChangeRaised', none)).toBe(true);
  });
});
