import { describe, expect, it } from 'vitest';
import { parseConceptChoice, parseConceptDecision, parseConceptOptions } from './concept-rows';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

describe('parseConceptOptions (B12)', () => {
  it('letters the rows by the position the database gave, sorted', () => {
    expect(
      parseConceptOptions([
        { id: C, position: 3 },
        { id: A, position: 1 },
        { id: B, position: 2 },
      ]),
    ).toEqual([
      { id: A, position: 1, letter: 'A' },
      { id: B, position: 2, letter: 'B' },
      { id: C, position: 3, letter: 'C' },
    ]);
  });

  it('drops a non-uuid id, a position outside 1..4 and a repeated position', () => {
    expect(
      parseConceptOptions([
        { id: 'not-a-uuid', position: 1 },
        { id: A, position: 0 },
        { id: A, position: 5 },
        { id: A, position: 1.5 },
        { id: A, position: '2' },
        { id: B, position: 2 },
        { id: C, position: 2 },
        null,
        7,
      ]),
    ).toEqual([{ id: B, position: 2, letter: 'B' }]);
  });

  it('reads a missing or non-array key as no options', () => {
    for (const raw of [undefined, null, {}, 'x', 3]) expect(parseConceptOptions(raw)).toEqual([]);
  });
});

describe('parseConceptChoice (B12)', () => {
  it('is the chosen id and the SAVED letter', () => {
    expect(parseConceptChoice(B, 2)).toEqual({ id: B, letter: 'B' });
  });

  it('is null unless both the id and the position are usable', () => {
    expect(parseConceptChoice(null, null)).toBeNull();
    expect(parseConceptChoice(B, null)).toBeNull();
    expect(parseConceptChoice(null, 2)).toBeNull();
    expect(parseConceptChoice('nope', 2)).toBeNull();
    expect(parseConceptChoice(B, 5)).toBeNull();
    expect(parseConceptChoice(B, '2')).toBeNull();
  });
});

describe('parseConceptDecision (B12)', () => {
  it('keeps the three decisions and drops anything else', () => {
    for (const decision of ['chosen', 'approved', 'changes_requested'] as const) {
      expect(parseConceptDecision(decision)).toBe(decision);
    }
    for (const raw of [null, undefined, '', 'CHOSEN', 'approve', 1, {}]) expect(parseConceptDecision(raw)).toBeNull();
  });
});
