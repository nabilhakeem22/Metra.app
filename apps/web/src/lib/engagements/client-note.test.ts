import { describe, expect, it } from 'vitest';
import { clientNote, isBlankNote } from './client-note';

describe('the client note rule (F9)', () => {
  it.each([
    ['empty', ''],
    ['spaces and a tab', '  \t\n'],
    ['a no-break space', ' '],
    ['an ideographic space', '　'],
    ['a zero-width space', '​'],
    ['a right-to-left mark', '‏'],
    ['a word joiner', '⁠'],
    ['an Arabic letter mark', '؜'],
    ['a mix', ' ​‏ ⁠'],
  ])('%s is blank', (_label, note) => {
    expect(isBlankNote(note)).toBe(true);
    expect(clientNote(note)).toBeNull();
  });

  it('a visible note is kept, trimmed and capped at 2000', () => {
    expect(isBlankNote(' أكبر ')).toBe(false);
    expect(clientNote(' أكبر ')).toBe('أكبر');
    expect(clientNote('x'.repeat(2500))).toHaveLength(2000);
    expect(clientNote(undefined)).toBeNull();
  });
});
