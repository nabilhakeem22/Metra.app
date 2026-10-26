import { describe, expect, it } from 'vitest';
import { readOptionalText } from './field-rules';
import { bilingualNameErrors, boundedText, requiredText } from './text-field-rules';

describe('text field rules', () => {
  it('requiredText refuses blank and whitespace, nothing else', () => {
    for (const blank of [null, undefined, '', '   ']) expect(requiredText(blank)).toEqual({ code: 'required' });
    expect(requiredText(' a ')).toBeNull();
  });

  it('boundedText counts code points of the trimmed value and says the cap', () => {
    expect(boundedText('abc', 3)).toBeNull();
    expect(boundedText('  abc  ', 3)).toBeNull();
    expect(boundedText('abcd', 3)).toEqual({ code: 'too_long', params: { max: 3 } });
    // Two astral characters are two characters, not four UTF-16 units.
    expect(boundedText('😀😀', 2)).toBeNull();
    expect(boundedText(null, 3)).toBeNull();
  });

  it('boundedText refuses a control character under the field, keeps tab and line breaks (F15)', () => {
    for (const pasted of ['Villa\u0000', 'a\u0007b', 'x\u001Fy', 'del\u007F'])
      expect(boundedText(pasted, 200), JSON.stringify(pasted)).toEqual({ code: 'unprintable' });
    expect(boundedText('line one\nline two\r\n\tindented', 200)).toBeNull();
    expect(readOptionalText('note\u0000', 2000)).toEqual({ ok: false, error: { code: 'unprintable' } });
    expect(readOptionalText('note\nmore', 2000)).toEqual({ ok: true, value: 'note\nmore' });
  });

  it('refuses a lone surrogate half as unprintable, keeps a whole astral character (H7.3 F8)', () => {
    // A half with no partner is no character: a jsonb audit row refuses it, so
    // it must be a refusal under the field, never a failed write.
    for (const pasted of ['x\uD800y', 'x\uDC00y', 'end\uDBFF', '\uDFFFstart', 'x\uDC00\uD800y']) {
      expect(readOptionalText(pasted, 2000), JSON.stringify(pasted)).toEqual({ ok: false, error: { code: 'unprintable' } });
      expect(boundedText(pasted, 200), JSON.stringify(pasted)).toEqual({ code: 'unprintable' });
    }
    expect(readOptionalText('tiles 😀 approved', 2000)).toEqual({ ok: true, value: 'tiles 😀 approved' });
    expect(boundedText('😀', 200)).toBeNull();
  });

  it('bilingualNameErrors: one name is enough, each is capped', () => {
    expect(bilingualNameErrors(null, null, 80)).toEqual({ name: { code: 'name_required' } });
    expect(bilingualNameErrors('Civil', null, 80)).toEqual({});
    expect(bilingualNameErrors('x'.repeat(81), 'مدني', 80)).toEqual({
      nameEn: { code: 'too_long', params: { max: 80 } },
    });
  });
});
