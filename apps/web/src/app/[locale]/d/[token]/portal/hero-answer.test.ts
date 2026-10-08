import { describe, expect, it } from 'vitest';
import { answerOfConceptOutcome, answerOfSignal } from './hero-answer';

// The hero confirms only a SAVED concept decision, and the tapped verb only for
// the design and handover signals.

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

describe('answerOfSignal', () => {
  it('confirms the tapped verb, and maps an unknown error to generic', () => {
    expect(answerOfSignal({ ok: true, studioNotified: true }, 'acknowledged')).toEqual({
      confirmed: { outcome: 'acknowledged', studioNotified: true },
    });
    expect(answerOfSignal({ ok: false, error: 'already_responded' }, 'approved')).toEqual({
      error: 'generic',
      refresh: false,
    });
  });
});
