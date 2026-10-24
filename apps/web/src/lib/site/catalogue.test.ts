import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { pluralParams } from '@/lib/format/plural-params';
import ar from '@/messages/ar-EG.json';
import en from '@/messages/en.json';
import { OUTBOX_STATES, SITE_NOTE_KINDS } from './outbox/types';
import { SITE_PRESENCES } from './presence';

// The app reads these labels by a dynamic key (`presence.${verdict}`), which
// catalogue parity cannot see: a value missing from BOTH files would throw
// MISSING_MESSAGE on the engineer's phone. Each vocabulary equals its labels.

const vocabularies = [
  ['presence', SITE_PRESENCES],
  ['noteKind', SITE_NOTE_KINDS],
  ['outbox.state', OUTBOX_STATES],
] as const;

function labelsAt(messages: unknown, path: string): Record<string, unknown> {
  return path.split('.').reduce((node, segment) => (node as Record<string, unknown>)[segment], messages) as Record<string, unknown>;
}

describe('site.* labels', () => {
  it.each(vocabularies)('site.%s has one non-empty label per value, in both locales', (path, values) => {
    for (const messages of [en.site, ar.site]) {
      const labels = labelsAt(messages, path);
      expect(Object.keys(labels).sort()).toEqual([...values].sort());
      for (const value of values) expect(String(labels[value]).trim()).not.toBe('');
    }
  });
});

// F7 (S1 functional test): ICU's `#` prints the locale's digits, Arabic-Indic in
// ar-EG (§4.1 forbids them). The copy prints {countText} from pluralParams.
describe('site.* plural copy, rendered', () => {
  const PLURAL_KEYS = ['outbox.unsent', 'signOut.confirmUnsent'] as const;
  const COUNTS = [0, 1, 2, 3, 5, 11, 12, 100, 101, 1234];
  const ARABIC_INDIC = /[٠-٩۰-۹]/;

  it.each([
    ['ar-EG', ar],
    ['en', en],
  ] as const)('%s renders every count in Latin digits, and the count it was given', (locale, messages) => {
    const translate = createTranslator({ locale, messages, namespace: 'site' });
    for (const key of PLURAL_KEYS) {
      for (const count of COUNTS) {
        const params = pluralParams('count', 'countText', count, locale);
        const rendered = translate(key, params);
        expect(rendered, `${key} ${count}`).not.toMatch(ARABIC_INDIC);
        if (count >= 3) expect(rendered, `${key} ${count}`).toContain(params.countText);
      }
    }
  });

  it('ar-EG picks the Arabic plural form by the number', () => {
    const translate = createTranslator({ locale: 'ar-EG', messages: ar, namespace: 'site' });
    const unsent = (count: number) => translate('outbox.unsent', pluralParams('count', 'countText', count, 'ar-EG'));
    expect(unsent(0)).toBe('مافيش حاجة مستنية تترفع');
    expect(unsent(2)).toBe('لسه في حاجتين ما اترفعوش');
    expect(unsent(5)).toBe('لسه في 5 حاجات ما اترفعوش');
    expect(unsent(12)).toBe('لسه في 12 حاجة ما اترفعتش');
    expect(unsent(1234)).toBe('لسه في 1,234 حاجة ما اترفعتش');
  });
});
