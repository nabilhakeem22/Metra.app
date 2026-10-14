import { describe, expect, it } from 'vitest';
import { maxCharacters, requiredText } from './text-field-rules';

describe('text field rules', () => {
  it('requiredText refuses blank and whitespace, nothing else', () => {
    for (const blank of [null, undefined, '', '   ']) expect(requiredText(blank)).toEqual({ code: 'required' });
    expect(requiredText(' a ')).toBeNull();
  });

  it('maxCharacters counts code points of the trimmed value and says the cap', () => {
    expect(maxCharacters('abc', 3)).toBeNull();
    expect(maxCharacters('  abc  ', 3)).toBeNull();
    expect(maxCharacters('abcd', 3)).toEqual({ code: 'too_long', params: { max: 3 } });
    // Two astral characters are two characters, not four UTF-16 units.
    expect(maxCharacters('😀😀', 2)).toBeNull();
    expect(maxCharacters(null, 3)).toBeNull();
  });
});
