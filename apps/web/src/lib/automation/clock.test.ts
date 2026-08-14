import { describe, expect, it } from 'vitest';
import {
  addDays,
  cairoHour,
  dayPeriodKey,
  daysBetween,
  todayInCairo,
  weekPeriodKey,
} from './clock';

describe('todayInCairo / cairoHour', () => {
  it('maps a UTC instant to the Cairo calendar day + hour (EET = UTC+2)', () => {
    // 2026-01-15 05:30 UTC = 07:30 Cairo (winter, UTC+2).
    const winter = new Date('2026-01-15T05:30:00Z');
    expect(todayInCairo(winter)).toBe('2026-01-15');
    expect(cairoHour(winter)).toBe(7);
  });

  it('rolls the Cairo day at the right instant (22:30 UTC = 00:30 next day Cairo)', () => {
    const lateUtc = new Date('2026-01-15T22:30:00Z');
    expect(todayInCairo(lateUtc)).toBe('2026-01-16');
    expect(cairoHour(lateUtc)).toBe(0);
  });

  it('07:00 Cairo (the send hour) is hour 7', () => {
    expect(cairoHour(new Date('2026-01-15T05:00:00Z'))).toBe(7);
  });
});

describe('period keys', () => {
  it('dayPeriodKey is the Cairo date', () => {
    expect(dayPeriodKey(new Date('2026-01-15T05:00:00Z'))).toBe('2026-01-15');
  });

  it('weekPeriodKey is a stable ISO week; same for every day Mon-Sun of that week', () => {
    // 2026-01-12 (Mon) … 2026-01-18 (Sun) all fall in ISO week 2026-W03.
    const monday = weekPeriodKey(new Date('2026-01-12T09:00:00Z'));
    const sunday = weekPeriodKey(new Date('2026-01-18T09:00:00Z'));
    expect(monday).toBe('2026-W03');
    expect(sunday).toBe('2026-W03');
  });

  it('ISO week can belong to the previous/next year at the boundary', () => {
    // 2027-01-01 is a Friday -> ISO week 2026-W53.
    expect(weekPeriodKey(new Date('2027-01-01T09:00:00Z'))).toBe('2026-W53');
  });
});

describe('daysBetween / addDays', () => {
  it('counts whole days and shifts dates', () => {
    expect(daysBetween('2026-01-10', '2026-01-15')).toBe(5);
    expect(daysBetween('2026-01-15', '2026-01-10')).toBe(-5);
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});
