import { describe, expect, it } from 'vitest';
import { revisedFinishDate } from './finish-date';

describe('revisedFinishDate', () => {
  it('AC19 time part: two approved orders of 15 days each move the finish by 30 days', () => {
    expect(revisedFinishDate('2026-06-30', 15 + 15)).toBe('2026-07-30');
  });

  it('no extension keeps the end date', () => {
    expect(revisedFinishDate('2026-06-30', 0)).toBe('2026-06-30');
  });

  it('crosses months, years and a leap day by the calendar', () => {
    expect(revisedFinishDate('2028-02-28', 1)).toBe('2028-02-29');
    expect(revisedFinishDate('2027-02-28', 1)).toBe('2027-03-01');
    expect(revisedFinishDate('2026-12-31', 1)).toBe('2027-01-01');
    expect(revisedFinishDate('2026-10-25', 3650)).toBe('2036-10-22');
  });

  it('a contract with no end date has no revised finish: only the days can be said', () => {
    expect(revisedFinishDate(null, 30)).toBeNull();
  });

  it('a day past what a date column holds, or a malformed end date, is no finish date', () => {
    expect(revisedFinishDate('9999-12-30', 5)).toBeNull();
    expect(revisedFinishDate('2026-06-30', 1e12)).toBeNull();
    expect(revisedFinishDate('30/06/2026', 1)).toBeNull();
  });
});
