import { describe, expect, it } from 'vitest';
import { CONCEPT_LETTERS, conceptLetter } from './concept-letter';
import { CONCEPT_OPTION_MAX } from './concept-options';

describe('conceptLetter', () => {
  it.each([
    [1, 'A'],
    [2, 'B'],
    [3, 'C'],
    [4, 'D'],
  ])('position %i is option %s', (position, letter) => {
    expect(conceptLetter(position)).toBe(letter);
  });

  it.each([0, 5, -1, 1.5, '2', null, undefined, Number.NaN, Number.POSITIVE_INFINITY, [1], {}])(
    'refuses %j',
    (position) => {
      expect(conceptLetter(position)).toBeNull();
    },
  );

  it('has exactly one letter per option the studio may record', () => {
    expect(CONCEPT_LETTERS).toHaveLength(CONCEPT_OPTION_MAX);
  });
});
