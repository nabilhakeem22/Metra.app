import { describe, expect, it } from 'vitest';
import ar from '@/messages/ar-EG.json';
import en from '@/messages/en.json';
import { ACTION_CODE_PROBLEM } from '@/lib/api/errors';
import { resolveActionError } from './error-message';
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
  en: en.errors as Record<string, string | undefined>,
  'ar-EG': ar.errors as Record<string, string | undefined>,
};

const codes = Object.keys(ACTION_CODE_PROBLEM) as ActionCode[];

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
    const translate = (key: string) => catalogues['ar-EG'][key] ?? '';
    for (const code of codes) expect(resolveActionError(code, translate)).not.toBe('');
    expect(resolveActionError(undefined, translate)).toBe(catalogues['ar-EG'].generic);
  });
});
