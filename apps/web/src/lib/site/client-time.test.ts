import { describe, expect, it } from 'vitest';
import { deviceTimeProblem, isLateUpload } from './client-time';

const SERVER_NOW = new Date('2026-10-23T09:00:00Z');
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const before = (ms: number) => new Date(SERVER_NOW.getTime() - ms);
const after = (ms: number) => new Date(SERVER_NOW.getTime() + ms);

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

  it('accepts the server instant itself', () => {
    expect(deviceTimeProblem(SERVER_NOW, SERVER_NOW)).toBeNull();
  });

  it('refuses to judge an invalid instant rather than wave it through', () => {
    expect(() => deviceTimeProblem(new Date('nope'), SERVER_NOW)).toThrow(RangeError);
    expect(() => deviceTimeProblem(SERVER_NOW, new Date('nope'))).toThrow(RangeError);
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

  it('refuses an invalid instant', () => {
    expect(() => isLateUpload(new Date('nope'), SERVER_NOW)).toThrow(RangeError);
  });
});
