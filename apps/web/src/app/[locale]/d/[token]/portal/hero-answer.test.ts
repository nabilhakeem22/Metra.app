import { describe, expect, it } from 'vitest';
import type { DesignWithBudgetOutcome } from '@/lib/engagements/review-outcome';
import {
  answerOfConceptOutcome,
  answerOfDesignOutcome,
  answerOfDesignWithBudgetOutcome,
  answerOfHandoverOutcome,
  type HeroAnswer,
} from './hero-answer';

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
  it('confirms the SAVED decision', () => {
    expect(answerOfDesignOutcome({ kind: 'approved', studioNotified: true })).toEqual({
      confirmed: { outcome: 'approved', studioNotified: true },
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

// Round D, AC S9: the one-tap approve+budget, one case per row of the plan's C5a
// table. A confirmed answer always goes up to the command card, which keeps it
// on screen across the refresh it runs; an error answer says itself whether
// the page re-reads.
describe('answerOfDesignWithBudgetOutcome (S9)', () => {
  const rows: Array<[string, DesignWithBudgetOutcome, HeroAnswer]> = [
    [
      'approved + acknowledged',
      { kind: 'approved', studioNotified: true, budget: 'acknowledged' },
      { confirmed: { outcome: 'approved', studioNotified: true, budget: 'acknowledged' } },
    ],
    [
      'approved + changed',
      { kind: 'approved', studioNotified: true, budget: 'changed' },
      { confirmed: { outcome: 'approved', studioNotified: true, budget: 'changed' } },
    ],
    [
      'approved + failed',
      { kind: 'approved', studioNotified: false, budget: 'failed' },
      { confirmed: { outcome: 'approved', studioNotified: false, budget: 'failed' } },
    ],
    [
      'changes_requested (a stale tab) + changed',
      { kind: 'changes_requested', studioNotified: true, budget: 'changed' },
      { confirmed: { outcome: 'changes', studioNotified: true, budget: 'changed' } },
    ],
    [
      'changes_requested (a stale tab) + acknowledged',
      { kind: 'changes_requested', studioNotified: false, budget: 'acknowledged' },
      { confirmed: { outcome: 'changes', studioNotified: false, budget: 'acknowledged' } },
    ],
    // F4: one sentence says both: the approval was not sent, the budget was recorded.
    ['changed + acknowledged', { kind: 'changed', budget: 'acknowledged' }, { error: 'designChangedBudgetSaved', refresh: true }],
    ['changed + changed', { kind: 'changed', budget: 'changed' }, { error: 'reviewChanged', refresh: true }],
    ['changed + failed', { kind: 'changed', budget: 'failed' }, { error: 'reviewChanged', refresh: true }],
    [
      'moved_on + acknowledged',
      { kind: 'moved_on', budget: 'acknowledged' },
      { error: 'movedOn', refresh: true, budget: 'acknowledged' },
    ],
    ['moved_on + changed', { kind: 'moved_on', budget: 'changed' }, { error: 'movedOn', refresh: true }],
    ['error before any write (stop)', { kind: 'error', error: 'token_expired' }, { error: 'token_expired', refresh: false }],
    // R4: the design half failed after the budget was saved: the error, the budget line, and a refresh.
    [
      'design error after a saved budget',
      { kind: 'error', error: 'generic', budget: 'acknowledged' },
      { error: 'generic', refresh: true, budget: 'acknowledged' },
    ],
  ];

  it.each(rows)('%s', (_label, outcome, answer) => {
    expect(answerOfDesignWithBudgetOutcome(outcome)).toEqual(answer);
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
