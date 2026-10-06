import { describe, expect, it } from 'vitest';
import { daysSince, isStale, STALE_AFTER_DAYS } from './delivery-age';

describe('daysSince', () => {
  const now = new Date('2026-09-11T12:00:00.000Z');

  it('floors to whole days', () => {
    expect(daysSince('2026-09-11T00:00:00.000Z', now)).toBe(0);
    expect(daysSince('2026-09-10T11:00:00.000Z', now)).toBe(1);
    expect(daysSince('2026-08-31T12:00:00.000Z', now)).toBe(11);
  });

  it('reads a future stamp as today rather than a negative age', () => {
    // Clock skew between the app and Postgres must not make the panel look
    // broken; "-1 days" reads as a bug in the sort, not in the data.
    expect(daysSince('2026-09-12T12:00:00.000Z', now)).toBe(0);
  });

  it('survives an unparseable stamp', () => {
    expect(daysSince('not-a-date', now)).toBe(0);
  });
});

describe('isStale', () => {
  it('turns over at a week', () => {
    expect(isStale(STALE_AFTER_DAYS - 1)).toBe(false);
    expect(isStale(STALE_AFTER_DAYS)).toBe(true);
  });
});
