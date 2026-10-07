import { describe, expect, it } from 'vitest';
import { formatRelativeTime } from './relative-time';

const NOW = Date.parse('2026-10-07T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const ARABIC_INDIC = /[٠-٩۰-۹]/;

describe('formatRelativeTime', () => {
  it('says now under a minute, and for a clock a little ahead', () => {
    expect(formatRelativeTime(ago(30_000), NOW, 'en')).toBe('now');
    expect(formatRelativeTime(ago(-5_000), NOW, 'en')).toBe('now');
  });

  it('counts minutes, hours and days', () => {
    expect(formatRelativeTime(ago(MINUTE), NOW, 'en')).toBe('1 minute ago');
    expect(formatRelativeTime(ago(3 * HOUR + 10 * MINUTE), NOW, 'en')).toBe('3 hours ago');
    expect(formatRelativeTime(ago(DAY), NOW, 'en')).toBe('yesterday');
    expect(formatRelativeTime(ago(2 * DAY), NOW, 'en')).toBe('2 days ago');
    expect(formatRelativeTime(ago(6 * DAY), NOW, 'en')).toBe('6 days ago');
  });

  it('past six days it is the date', () => {
    expect(formatRelativeTime(ago(8 * DAY), NOW, 'en')).toBe('29/09/2026');
  });

  it('ar-EG: 1 min, 3 h, 2 d and the date carry only Latin digits', () => {
    for (const elapsed of [MINUTE, 3 * HOUR, 2 * DAY, 8 * DAY]) {
      const text = formatRelativeTime(ago(elapsed), NOW, 'ar-EG');
      expect(text).not.toBe('');
      expect(ARABIC_INDIC.test(text)).toBe(false);
    }
    expect(formatRelativeTime(ago(3 * HOUR), NOW, 'ar-EG')).toContain('3');
  });

  it('an invalid instant renders nothing', () => {
    expect(formatRelativeTime('nope', NOW, 'en')).toBe('');
  });
});
