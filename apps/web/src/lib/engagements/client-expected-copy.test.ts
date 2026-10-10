// Fix round F3 + F9: the expected-date path says what actually happened.
import { describe, expect, it } from 'vitest';
import ar from '@/messages/ar-EG.json';
import en from '@/messages/en.json';

describe('expected-date copy', () => {
  it('tells "the date passed" apart from "the stage moved"', () => {
    for (const catalogue of [en, ar]) {
      const copy = catalogue.engagements.clientExpected;
      expect(copy.stale).not.toBe(copy.moved);
    }
    expect(en.engagements.clientExpected.moved).toMatch(/stage/);
  });

  it('a closed delivery no longer talks about payments, and out of range is not "invalid"', () => {
    expect(en.errors.engagement_not_active).not.toMatch(/payment/i);
    expect(ar.errors.engagement_not_active).not.toMatch(/دفع/);
    expect(en.errors.expected_date_out_of_range).not.toBe(en.errors.invalid_date);
    expect(en.errors.expected_date_out_of_range).toMatch(/today/);
  });
});
