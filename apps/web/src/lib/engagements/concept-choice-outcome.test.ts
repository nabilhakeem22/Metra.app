import { describe, expect, it } from 'vitest';
import {
  ACT_OF_DECISION,
  outcomeOfRefusedLetter,
  outcomeOfSavedDecision,
  type SavedConcept,
} from './concept-choice-outcome';

const B = '22222222-2222-4222-8222-222222222222';

function saved(overrides: Partial<SavedConcept>): SavedConcept {
  return { clientActions: [], conceptChoice: null, conceptDecision: null, ...overrides };
}

describe('outcomeOfSavedDecision (F1: only a SAVED letter is named)', () => {
  it('a saved choice answers its saved letter', () => {
    expect(
      outcomeOfSavedDecision(saved({ conceptDecision: 'chosen', conceptChoice: { id: B, letter: 'B' } }), true),
    ).toEqual({ kind: 'chosen', letter: 'B', studioNotified: true });
  });

  it('a plain approval and a change request name no letter', () => {
    expect(outcomeOfSavedDecision(saved({ conceptDecision: 'approved' }), false)).toEqual({
      kind: 'approved',
      studioNotified: false,
    });
    expect(outcomeOfSavedDecision(saved({ conceptDecision: 'changes_requested' }), true)).toEqual({
      kind: 'changes_requested',
      studioNotified: true,
    });
  });

  it('a choice whose letter cannot be read is an approval, never a guessed letter', () => {
    expect(outcomeOfSavedDecision(saved({ conceptDecision: 'chosen' }), false)).toEqual({
      kind: 'approved',
      studioNotified: false,
    });
  });

  it('no decision on file, or no snapshot, means the step moved on', () => {
    expect(outcomeOfSavedDecision(saved({}), true)).toEqual({ kind: 'moved_on' });
    expect(outcomeOfSavedDecision(null, true)).toEqual({ kind: 'moved_on' });
  });

  it('notifies the act on file', () => {
    expect(ACT_OF_DECISION).toEqual({
      chosen: 'concept_chosen',
      approved: 'concept_approved',
      changes_requested: 'concept_changes_requested',
    });
  });
});

describe('outcomeOfRefusedLetter (F5)', () => {
  it('the choice still open: the options changed', () => {
    expect(outcomeOfRefusedLetter(saved({ clientActions: ['approve_concept'] }))).toEqual({
      kind: 'options_changed',
    });
  });

  it('the choice closed, or unreadable: the step moved on', () => {
    expect(outcomeOfRefusedLetter(saved({ clientActions: ['approve_design'] }))).toEqual({ kind: 'moved_on' });
    expect(outcomeOfRefusedLetter(null)).toEqual({ kind: 'moved_on' });
  });
});
