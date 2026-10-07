import { describe, expect, it } from 'vitest';
import { cairoYear, docYear, formatDocNumber } from './doc-number';

// F10: ONE year rule for document numbers, Africa/Cairo, whatever the runtime's
// zone (UTC on the Worker, the browser's elsewhere). The notification params
// and the studio email read the year in Cairo, so the page must too.
describe('the document year is Cairo time', () => {
  it('an instant late on Dec 31 UTC is already next year in Cairo', () => {
    expect(cairoYear('2026-12-31T22:30:00Z')).toBe(2027);
    expect(docYear(null, '2026-12-31T22:30:00Z')).toBe(2027);
    expect(formatDocNumber('DE', 1, docYear(null, new Date('2026-12-31T22:30:00Z')))).toBe('DE-2027-0001');
  });

  it('an instant early on Jan 1 UTC is still that year in Cairo', () => {
    expect(docYear(null, '2027-01-01T00:30:00Z')).toBe(2027);
    expect(docYear(null, '2026-12-31T21:59:00Z')).toBe(2026);
  });

  it('a date-only issue date is taken as written; a timestamp one is read in Cairo', () => {
    expect(docYear('2026-12-31', '2027-03-01T00:00:00Z')).toBe(2026);
    expect(docYear('2026-12-31T23:00:00Z', '2025-01-01T00:00:00Z')).toBe(2027);
  });

  it('an invalid issue date falls back to the creation year; an invalid instant is NaN', () => {
    expect(docYear('not a date', '2026-06-01T00:00:00Z')).toBe(2026);
    expect(cairoYear('nope')).toBeNaN();
  });
});
