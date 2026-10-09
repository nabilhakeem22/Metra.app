import { describe, expect, it } from 'vitest';
import { dayCountPhrase } from './day-count';

describe('dayCountPhrase', () => {
  it('English singular and plural', () => {
    expect(dayCountPhrase(1, 'en')).toBe('1 day');
    expect(dayCountPhrase(6, 'en')).toBe('6 days');
  });

  it('Arabic agrees with the number, Latin digits', () => {
    expect(dayCountPhrase(1, 'ar-EG')).toBe('يوم');
    expect(dayCountPhrase(2, 'ar-EG')).toBe('يومين');
    expect(dayCountPhrase(3, 'ar-EG')).toBe('3 أيام');
    expect(dayCountPhrase(10, 'ar-EG')).toBe('10 أيام');
    expect(dayCountPhrase(11, 'ar-EG')).toBe('11 يوم');
    expect(dayCountPhrase(90, 'ar-EG')).toBe('90 يوم');
    expect(dayCountPhrase(103, 'ar-EG')).toBe('103 أيام');
  });
});
