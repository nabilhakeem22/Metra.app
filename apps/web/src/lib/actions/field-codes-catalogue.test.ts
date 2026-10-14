import { describe, expect, it } from 'vitest';
import ar from '@/messages/ar-EG.json';
import en from '@/messages/en.json';
import { FIELD_CODE_PARAMS, isFieldCode, type FieldCode } from './field-codes';

// `describeFieldError` reads `field.<code>` dynamically, under the studio
// `errors` namespace and the client `portal.errors` one. A rule missing from a
// catalogue would throw MISSING_MESSAGE under a field, and a message whose ICU
// arguments differ from what the rule sends would print `{max}` literally.

type FieldCatalogue = Record<string, string | undefined>;

const catalogues: Record<string, FieldCatalogue> = {
  'en errors': en.errors.field,
  'ar-EG errors': ar.errors.field,
  'en portal.errors': en.portal.errors.field,
  'ar-EG portal.errors': ar.portal.errors.field,
};

const codes = Object.keys(FIELD_CODE_PARAMS) as FieldCode[];

/** The argument names a simple ICU message interpolates, sorted. */
function argumentsOf(message: string): string[] {
  const names = [...message.matchAll(/\{\s*([A-Za-z_]\w*)\s*[,}]/g)].map((match) => match[1]);
  return [...new Set(names)].sort();
}

describe('every FieldCode can be shown under a field', () => {
  it.each(codes)('%s', (code) => {
    const expected = [...FIELD_CODE_PARAMS[code]].sort();
    for (const [where, catalogue] of Object.entries(catalogues)) {
      const message = catalogue[code];
      expect(typeof message === 'string' && message.trim() !== '', `${where}.field.${code} is missing`).toBe(true);
      expect(argumentsOf(message!), `${where}.field.${code} arguments`).toEqual(expected);
    }
  });

  it('carries no field message the vocabulary does not know', () => {
    for (const catalogue of Object.values(catalogues)) {
      expect(Object.keys(catalogue).sort()).toEqual([...codes].sort());
    }
  });

  it('isFieldCode knows the vocabulary and nothing inherited', () => {
    expect(isFieldCode('too_long')).toBe(true);
    expect(isFieldCode('phone_required')).toBe(false);
    expect(isFieldCode('toString')).toBe(false);
  });
});
