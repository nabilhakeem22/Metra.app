import { describe, expect, it } from 'vitest';
import { messageAt, type TestLocale } from '@/test/render-with-intl';
import { uploadOutcomeMessage } from './upload-outcome-message';

// F4, F5: a deliverable upload that did not land says its cause, an unknown
// failure's reference, and a request that never answered as unreachable.

describe.each<TestLocale>(['en', 'ar-EG'])('uploadOutcomeMessage (%s)', (locale) => {
  const t = (key: string) => messageAt(locale, `engagements.files.${key}`);
  const te = (key: string, values?: Record<string, string | number>) =>
    messageAt(locale, `errors.${key}`).replace('{reference}', String(values?.reference ?? '{reference}'));

  it('an unknown failure carries its reference', () => {
    expect(uploadOutcomeMessage({ ok: false, reason: 'generic', reference: 'K7Q29MXD' }, t, te)).toBe(
      `${te('generic')} ${te('reference', { reference: 'K7Q29MXD' })}`,
    );
  });

  it('a request that never reached Metra says to check the connection', () => {
    expect(uploadOutcomeMessage({ ok: false, reason: 'rejected', rejection: new TypeError('Failed to fetch') }, t, te)).toBe(
      te('unreachable'),
    );
  });

  it('a coded refusal says its own sentence', () => {
    expect(uploadOutcomeMessage({ ok: false, reason: 'storage_unavailable' }, t, te)).toBe(te('storage_unavailable'));
    expect(uploadOutcomeMessage({ ok: false, reason: 'too_large' }, t, te)).toBe(t('tooLarge'));
  });
});
