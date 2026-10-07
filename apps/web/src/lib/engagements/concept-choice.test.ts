import { describe, expect, it } from 'vitest';
import { chosenConceptOf, letteredConceptOptions, type ConceptChoiceEvent } from './concept-choice';

const OPTION_A = '11111111-1111-4111-8111-111111111111';
const OPTION_B = '22222222-2222-4222-8222-222222222222';

function event(overrides: Partial<ConceptChoiceEvent> & { id: string }): ConceptChoiceEvent {
  return {
    kind: 'concept_approval',
    supersedesEventId: null,
    decidedAt: new Date('2026-10-01T10:00:00Z'),
    chosenArtifactId: null,
    chosenPosition: null,
    ...overrides,
  };
}

describe('chosenConceptOf', () => {
  it('is the option and the letter SAVED with the choice', () => {
    expect(
      chosenConceptOf([event({ id: 'e1', chosenArtifactId: OPTION_B, chosenPosition: 2 })]),
    ).toEqual({ artifactId: OPTION_B, letter: 'B' });
  });

  it('takes the newest live choice; a retracted one answers nothing', () => {
    const older = event({ id: 'e1', chosenArtifactId: OPTION_A, chosenPosition: 1 });
    const newer = event({
      id: 'e2',
      chosenArtifactId: OPTION_B,
      chosenPosition: 2,
      decidedAt: new Date('2026-10-02T10:00:00Z'),
    });
    expect(chosenConceptOf([newer, older])).toEqual({ artifactId: OPTION_B, letter: 'B' });
    const correction = event({ id: 'c1', kind: 'event_correction', supersedesEventId: 'e2' });
    expect(chosenConceptOf([newer, older, correction])).toEqual({ artifactId: OPTION_A, letter: 'A' });
    expect(
      chosenConceptOf([older, event({ id: 'c2', kind: 'event_correction', supersedesEventId: 'e1' })]),
    ).toBeNull();
  });

  it('ignores an approval naming no option, a letter outside A..D, and other kinds', () => {
    expect(
      chosenConceptOf([
        event({ id: 'e1' }),
        event({ id: 'e2', chosenArtifactId: OPTION_A, chosenPosition: 5 }),
        event({ id: 'e3', kind: 'design_approval', chosenArtifactId: OPTION_A, chosenPosition: 1 }),
      ]),
    ).toBeNull();
  });
});

describe('letteredConceptOptions', () => {
  it('keeps the lettered options only, in letter order', () => {
    expect(
      letteredConceptOptions([
        { id: 'c', conceptPosition: 3 },
        { id: 'hidden', conceptPosition: null },
        { id: 'a', conceptPosition: 1 },
        { id: 'fifth', conceptPosition: 5 },
      ]),
    ).toEqual([
      { id: 'a', letter: 'A' },
      { id: 'c', letter: 'C' },
    ]);
  });
});
