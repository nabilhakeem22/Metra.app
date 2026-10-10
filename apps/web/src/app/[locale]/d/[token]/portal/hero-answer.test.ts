import { describe, expect, it } from 'vitest';
import { answerOfConceptOutcome, answerOfDesignOutcome, answerOfHandoverOutcome } from './hero-answer';

// The hero confirms only a SAVED decision, for the concept, the final design and
// the handover alike; a step that moved on reads the same for all three.

describe('answerOfConceptOutcome', () => {
  it('names the saved letter on a choice, none on an approval or a change request', () => {
    expect(answerOfConceptOutcome({ kind: 'chosen', letter: 'B', studioNotified: true })).toEqual({
      confirmed: { outcome: 'approved', studioNotified: true, chosenLetter: 'B' },
    });
    expect(answerOfConceptOutcome({ kind: 'approved', studioNotified: false })).toEqual({
      confirmed: { outcome: 'approved', studioNotified: false },
    });
    expect(answerOfConceptOutcome({ kind: 'changes_requested', studioNotified: true })).toEqual({
      confirmed: { outcome: 'changes', studioNotified: true },
    });
  });

  it('refreshes on changed options or a closed review; a plain error does not', () => {
    expect(answerOfConceptOutcome({ kind: 'options_changed' })).toEqual({ error: 'changed', refresh: true });
    expect(answerOfConceptOutcome({ kind: 'moved_on' })).toEqual({ error: 'movedOn', refresh: true });
    expect(answerOfConceptOutcome({ kind: 'error', error: 'not_active' })).toEqual({
      error: 'not_active',
      refresh: false,
    });
  });
});

describe('answerOfDesignOutcome (AC 55, 56)', () => {
  it('confirms the SAVED decision, with the budget when it was acknowledged too', () => {
    expect(answerOfDesignOutcome({ kind: 'approved', studioNotified: true })).toEqual({
      confirmed: { outcome: 'approved', studioNotified: true },
    });
    expect(answerOfDesignOutcome({ kind: 'approved', studioNotified: false, budgetAcknowledged: true })).toEqual({
      confirmed: { outcome: 'approved', studioNotified: false, budgetAcknowledged: true },
    });
    expect(answerOfDesignOutcome({ kind: 'approved', studioNotified: false, budgetAcknowledged: false })).toEqual({
      confirmed: { outcome: 'approved', studioNotified: false },
    });
    expect(answerOfDesignOutcome({ kind: 'changes_requested', studioNotified: true })).toEqual({
      confirmed: { outcome: 'changes', studioNotified: true },
    });
  });

  it('moved on refreshes; an error does not', () => {
    expect(answerOfDesignOutcome({ kind: 'moved_on' })).toEqual({ error: 'movedOn', refresh: true });
    expect(answerOfDesignOutcome({ kind: 'error', error: 'generic' })).toEqual({ error: 'generic', refresh: false });
  });
});

describe('answerOfHandoverOutcome (AC 55, 56)', () => {
  it('acknowledged while one is on file; moved on refreshes; an error does not', () => {
    expect(answerOfHandoverOutcome({ kind: 'acknowledged', studioNotified: true })).toEqual({
      confirmed: { outcome: 'acknowledged', studioNotified: true },
    });
    expect(answerOfHandoverOutcome({ kind: 'moved_on' })).toEqual({ error: 'movedOn', refresh: true });
    expect(answerOfHandoverOutcome({ kind: 'error', error: 'token_expired' })).toEqual({ error: 'token_expired', refresh: false });
  });
});
