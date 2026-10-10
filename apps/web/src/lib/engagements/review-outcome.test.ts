import { describe, expect, it } from 'vitest';
import {
  answersFromSaved,
  designOutcomeOfSaved,
  handoverOutcomeOfSaved,
  isDesignVerb,
} from './review-outcome';

// Carry-over 5 (AC 55, 56): a design or handover tap confirms only what is SAVED.

describe('answersFromSaved', () => {
  it('a repeat, a closed review or an ended delivery asks the snapshot; a first ok and other refusals do not', () => {
    expect(answersFromSaved({ ok: true, code: 'already' })).toBe(true);
    expect(answersFromSaved({ ok: false, error: 'wrong_state' })).toBe(true);
    expect(answersFromSaved({ ok: false, error: 'not_active' })).toBe(true);
    expect(answersFromSaved({ ok: true })).toBe(false);
    expect(answersFromSaved({ ok: false, error: 'token_expired' })).toBe(false);
    expect(answersFromSaved({ ok: false })).toBe(false);
  });
});

describe('designOutcomeOfSaved', () => {
  it('names the decision on file, whatever was tapped', () => {
    const at = '2026-10-01T09:00:00.000Z';
    expect(designOutcomeOfSaved({ designDecision: { kind: 'approved', at }, stageKey: 'drawings' }, true)).toEqual({ kind: 'approved', studioNotified: true });
    expect(designOutcomeOfSaved({ designDecision: { kind: 'changes_requested', at }, stageKey: 'drawings' }, false)).toEqual({
      kind: 'changes_requested',
      studioNotified: false,
    });
  });

  it('nothing on file, or no snapshot: the step moved on', () => {
    expect(designOutcomeOfSaved({ designDecision: null, stageKey: 'drawings' }, true)).toEqual({ kind: 'moved_on' });
    expect(designOutcomeOfSaved(null, true)).toEqual({ kind: 'moved_on' });
    // F12: still at the final approval (a withdrawn decision): changed, not moved on.
    expect(designOutcomeOfSaved({ designDecision: null, stageKey: 'finalApproval' }, true)).toEqual({ kind: 'changed' });
  });
});

describe('handoverOutcomeOfSaved', () => {
  it('acknowledged while a confirmation is on file, else moved on', () => {
    expect(handoverOutcomeOfSaved({ handoverAcknowledgedAt: '2026-10-01T09:00:00.000Z', stageKey: 'delivered' }, true)).toEqual({
      kind: 'acknowledged',
      studioNotified: true,
    });
    expect(handoverOutcomeOfSaved({ handoverAcknowledgedAt: null, stageKey: 'delivered' }, true)).toEqual({ kind: 'moved_on' });
    expect(handoverOutcomeOfSaved(null, false)).toEqual({ kind: 'moved_on' });
    expect(handoverOutcomeOfSaved({ handoverAcknowledgedAt: null, stageKey: 'handover' }, false)).toEqual({ kind: 'changed' });
  });
});

describe('isDesignVerb', () => {
  it('only the two design verbs', () => {
    expect(isDesignVerb('approve_design')).toBe(true);
    expect(isDesignVerb('request_design_changes')).toBe(true);
    expect(isDesignVerb('approve_concept')).toBe(false);
    expect(isDesignVerb(undefined)).toBe(false);
  });
});
