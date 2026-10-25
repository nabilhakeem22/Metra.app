import { describe, expect, it } from 'vitest';
import { deviceTimeProblem, isLateUpload } from './client-time';

const SERVER_NOW = new Date('2026-10-23T09:00:00Z');
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The device time `ms` before or after the server's now, written as the phone writes it. */
const before = (ms: number) => new Date(SERVER_NOW.getTime() - ms).toISOString();
const after = (ms: number) => new Date(SERVER_NOW.getTime() + ms).toISOString();

describe('deviceTimeProblem: the plan examples (AC3)', () => {
  it('a check-in 10 minutes ahead of the server is in_future', () => {
    expect(deviceTimeProblem(after(10 * MINUTE), SERVER_NOW)).toBe('in_future');
  });

  it('one 31 days old is too_old', () => {
    expect(deviceTimeProblem(before(31 * DAY), SERVER_NOW)).toBe('too_old');
  });

  it('one 3 hours old is accepted, and its visit counts as a late upload', () => {
    const checkedInAt = before(3 * HOUR);
    expect(deviceTimeProblem(checkedInAt, SERVER_NOW)).toBeNull();
    expect(isLateUpload(checkedInAt, SERVER_NOW)).toBe(true);
  });
});

describe('deviceTimeProblem: the edges', () => {
  it('allows the clock to run up to 5 minutes ahead, not a millisecond more', () => {
    expect(deviceTimeProblem(after(5 * MINUTE), SERVER_NOW)).toBeNull();
    expect(deviceTimeProblem(after(5 * MINUTE + 1), SERVER_NOW)).toBe('in_future');
  });

  it('accepts exactly 30 days old, not a millisecond older', () => {
    expect(deviceTimeProblem(before(30 * DAY), SERVER_NOW)).toBeNull();
    expect(deviceTimeProblem(before(30 * DAY + 1), SERVER_NOW)).toBe('too_old');
  });

  it('accepts the server instant itself, and reads an explicit offset as its instant', () => {
    expect(deviceTimeProblem('2026-10-23T09:00:00Z', SERVER_NOW)).toBeNull();
    expect(deviceTimeProblem('2026-10-23T12:05:00+03:00', SERVER_NOW)).toBeNull();
    expect(deviceTimeProblem('2026-10-23T12:05:00.001+03:00', SERVER_NOW)).toBe('in_future');
  });

  it('refuses to judge an invalid server instant rather than wave it through', () => {
    expect(() => deviceTimeProblem(before(0), new Date('nope'))).toThrow(RangeError);
  });

  // F8 (S1 functional test): the clock checks read device times as strictly as cairoDate.
  it.each(['nope', '2026-02-30T08:00:00Z', '2026-10-23T08:00:00', '1'])('refuses the device time %s', (deviceTime) => {
    expect(() => deviceTimeProblem(deviceTime, SERVER_NOW)).toThrow(RangeError);
    expect(() => isLateUpload(deviceTime, SERVER_NOW)).toThrow(RangeError);
  });
});

describe('isLateUpload', () => {
  it('is late only past two hours', () => {
    expect(isLateUpload(before(2 * HOUR), SERVER_NOW)).toBe(false);
    expect(isLateUpload(before(2 * HOUR + 1), SERVER_NOW)).toBe(true);
    expect(isLateUpload(before(10 * MINUTE), SERVER_NOW)).toBe(false);
  });

  it('is not late when the device clock ran ahead of the server', () => {
    expect(isLateUpload(after(4 * MINUTE), SERVER_NOW)).toBe(false);
  });

  it('refuses an invalid server instant', () => {
    expect(() => isLateUpload(before(0), new Date('nope'))).toThrow(RangeError);
  });
});
