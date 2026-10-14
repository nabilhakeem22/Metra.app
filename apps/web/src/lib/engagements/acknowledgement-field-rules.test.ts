import { describe, expect, it } from 'vitest';
import { acknowledgementFieldErrors, readAcknowledgementFields } from './acknowledgement-field-rules';

const TODAY = '2026-09-10';

describe('the day an acknowledgement happened', () => {
  it('accepts a real past day, today, and no day at all', () => {
    for (const occurredOn of ['2026-09-06', TODAY, '', null, undefined]) {
      expect(acknowledgementFieldErrors({ occurredOn }, TODAY), String(occurredOn)).toEqual({});
    }
  });

  it('says the future is the future: you cannot already have been told it', () => {
    for (const occurredOn of ['2026-09-11', '2027-01-01']) {
      expect(acknowledgementFieldErrors({ occurredOn }, TODAY)).toEqual({
        occurredOn: { code: 'date_in_future' },
      });
    }
  });

  it('refuses a day the calendar does not have, and anything not a bare YYYY-MM-DD', () => {
    // `new Date('2026-02-31')` silently rolls to 2026-03-03: round-tripping is
    // what catches it, a plain regex would store the wrong day.
    for (const occurredOn of ['2026-02-31', '2026-13-01', '2026-00-10', '2026-9-6', '06/09/2026', 'today']) {
      expect(acknowledgementFieldErrors({ occurredOn }, TODAY), occurredOn).toEqual({
        occurredOn: { code: 'invalid_date' },
      });
    }
  });
});

describe('readAcknowledgementFields', () => {
  it('says every over-long text at once, with its cap', () => {
    const long = 'x'.repeat(2001);
    expect(acknowledgementFieldErrors({ evidence: long, note: long }, TODAY)).toEqual({
      evidence: { code: 'too_long', params: { max: 2000 } },
      note: { code: 'too_long', params: { max: 2000 } },
    });
  });

  it('trims what it stores and keeps an empty box empty', () => {
    expect(readAcknowledgementFields({ evidence: '  WhatsApp ', note: ' ' }, TODAY)).toEqual({
      ok: true,
      values: { occurredOn: null, evidence: 'WhatsApp', note: null },
    });
  });
});
