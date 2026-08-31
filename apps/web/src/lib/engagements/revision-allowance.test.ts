import { describe, expect, it } from 'vitest';
import {
  isRevisionTrigger,
  revisionAllowanceFor,
  revisionAmountRequired,
  revisionTriggerAtState,
  type RevisionAllowances,
} from './revision-allowance';
import { DESIGN_STATES, type DesignState } from './states';
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

describe('revisionTriggerAtState', () => {
  const DESIGN_LOOP_STATES: DesignState[] = [
    'design_3d',
    'final_approval',
    'shop_drawings',
    // The as-built detour off final_approval, which returns to it. No revision
    // edge fires from here, but treating it as a concept state made the badge
    // FLIP mid-detour (3D 1 of 3 -> Revision 3 of 3 -> 3D 1 of 3), which reads
    // as a bug. The design pair is coherent across the whole neighbourhood.
    'change_triage',
  ];

  it('names the DESIGN edge across the 3D loop states', () => {
    for (const state of DESIGN_LOOP_STATES) {
      expect(revisionTriggerAtState(state)).toBe('designChangeRaised');
    }
  });

  it('names the CONCEPT edge at every other state', () => {
    const designLoop = new Set<DesignState>(DESIGN_LOOP_STATES);
    for (const state of DESIGN_STATES.filter((s) => !designLoop.has(s))) {
      expect(revisionTriggerAtState(state)).toBe('requestRevision');
    }
  });

  it('covers every state the 3D edge fires FROM, plus the one it lands on', () => {
    // Anchors the state list to the registry: if `designChangeRaised` ever gains
    // (or loses) a `from` state, the cockpit badge must follow it or it would
    // report a concept allowance on a screen offering a 3D revision.
    const edge = TRANSITIONS.designChangeRaised;
    const from = Array.isArray(edge.from) ? edge.from : [edge.from];
    for (const state of [...from, edge.to]) {
      expect(revisionTriggerAtState(state)).toBe('designChangeRaised');
    }
  });

  it('reads the pair a burned CONCEPT allowance must NOT contaminate', () => {
    // The badge bug this fixes: at design_3d the concept pair says 3-of-3 while
    // the revision form correctly offers a FREE 3D revision.
    expect(
      revisionAllowanceFor(revisionTriggerAtState('design_3d'), CONCEPT_BURNED),
    ).toEqual({ count: 0, free: 3 });
    expect(
      revisionAllowanceFor(revisionTriggerAtState('negotiation'), CONCEPT_BURNED),
    ).toEqual({ count: 3, free: 3 });
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
