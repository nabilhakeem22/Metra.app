import { ENGAGEMENT_EVENT_KINDS } from '@metra/db';
import { describe, expect, it } from 'vitest';
import ar from '@/messages/ar-EG.json';
import en from '@/messages/en.json';

// The timeline renders a ledger row's label with t(`eventKind.${kind}`), a
// DYNAMIC key: parity between the two catalogues passes happily when a kind is
// missing from BOTH, and next-intl then throws MISSING_MESSAGE in front of the
// studio. `event_correction` shipped that way. The enum is the source of truth,
// so the labels are asserted against it rather than against each other.
const labels = {
  en: en.engagements.eventKind as Record<string, string | undefined>,
  'ar-EG': ar.engagements.eventKind as Record<string, string | undefined>,
};

describe('engagements.eventKind labels', () => {
  it.each(ENGAGEMENT_EVENT_KINDS)('%s has a label in both catalogues', (kind) => {
    for (const [locale, catalogue] of Object.entries(labels)) {
      const label = catalogue[kind];
      expect(label, `engagements.eventKind.${kind} missing in ${locale}`).toBeTruthy();
    }
  });
});
