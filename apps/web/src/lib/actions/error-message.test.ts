import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import ar from '@/messages/ar-EG.json';
import en from '@/messages/en.json';
import { ACTION_CODE_PROBLEM } from '@/lib/api/action-code-problem';
import {
  describeFailure,
  describeRejection,
  resolveActionError,
  type Translate,
} from './error-message';
import { describeFieldError } from './field-error-message';
import type { ActionCode } from './result';

// `resolveActionError(code, t)` is `t(code)` — a DYNAMIC key. Catalogue parity is
// satisfied by a code missing from BOTH files, and next-intl then throws
// MISSING_MESSAGE in front of the studio. Eleven codes shipped that way and were
// only invisible because one screen happened to map them by hand.
//
// `ACTION_CODE_PROBLEM` is the source of truth here because it is the only
// RUNTIME-enumerable form of the union: it is declared `Record<ActionCode, ...>`,
// so tsc already refuses to compile it with a code missing. Adding a code to
// `ActionCode` and forgetting its string is what this test makes impossible.

const catalogues = {
  en: en.errors as Record<string, unknown>,
  'ar-EG': ar.errors as Record<string, unknown>,
};

const codes = Object.keys(ACTION_CODE_PROBLEM) as ActionCode[];

/** The real next-intl formatter over the studio `errors` namespace. */
function errorsTranslator(locale: 'en' | 'ar-EG'): Translate {
  return createTranslator({
    locale,
    messages: locale === 'en' ? en : ar,
    namespace: 'errors',
  }) as unknown as Translate;
}

const tEn = errorsTranslator('en');

describe('every ActionCode can be shown to a human', () => {
  it('enumerates the whole union, not a stale copy of it', () => {
    expect(codes.length).toBeGreaterThan(90);
  });

  it.each(codes)('%s', (code) => {
    for (const [locale, catalogue] of Object.entries(catalogues)) {
      const message = catalogue[code];
      expect(
        typeof message === 'string' && message.trim().length > 0,
        `ActionCode "${code}" has no errors.${code} in messages/${locale}.json`,
      ).toBe(true);
    }
  });

  it('resolves through the real mapper, not just the raw catalogue', () => {
    // Guards the indirection itself: if resolveActionError ever stopped passing
    // the code through verbatim, every assertion above would still pass.
    const translate = errorsTranslator('ar-EG');
    for (const code of codes) expect(resolveActionError(code, translate)).not.toBe('');
    expect(resolveActionError(undefined, translate)).toBe(catalogues['ar-EG'].generic);
  });
});

describe('describeFailure', () => {
  it('hands over the reference of an unknown failure', () => {
    expect(describeFailure({ error: 'generic', reference: 'K7Q29MXD' }, tEn)).toBe(
      `${en.errors.generic} ${en.errors.reference.replace('{reference}', 'K7Q29MXD')}`,
    );
  });

  it('is the plain generic sentence without a reference', () => {
    expect(describeFailure({ error: 'generic' }, tEn)).toBe(en.errors.generic);
  });

  it('is the code message for any other failure', () => {
    expect(describeFailure({ error: 'forbidden' }, tEn)).toBe(en.errors.forbidden);
  });
});

describe('describeRejection', () => {
  it('turns a server throw into generic plus its digest', () => {
    const thrown = Object.assign(new Error('An error occurred'), { digest: '123' });
    const text = describeRejection(thrown, tEn);
    expect(text).toContain('123');
    expect(text.startsWith(en.errors.generic)).toBe(true);
  });

  it('says Metra could not be reached for a failed fetch', () => {
    expect(describeRejection(new TypeError('fetch failed'), tEn)).toBe(en.errors.unreachable);
  });

  it('falls back to generic for anything else', () => {
    expect(describeRejection(new Error('boom'), tEn)).toBe(en.errors.generic);
    expect(describeRejection(undefined, tEn)).toBe(en.errors.generic);
  });
});

describe('describeFieldError', () => {
  it('reads a label-free rule from field.<code> with its params', () => {
    expect(describeFieldError({ code: 'too_long', params: { max: 120 } }, tEn)).toBe(
      'Too long. Keep it to 120 characters or fewer.',
    );
    expect(describeFieldError({ code: 'required' }, tEn)).toBe(en.errors.field.required);
  });

  it('reads a domain code from its own message', () => {
    expect(describeFieldError({ code: 'phone_required' }, tEn)).toBe(en.errors.phone_required);
  });
});
