import { describe, expect, it } from 'vitest';
import { waitParts } from './code-time';

describe('the code panel\'s waits', () => {
  it('counts down M:SS under an hour, never below 0:00', () => {
    expect(waitParts(60)).toEqual({ kind: 'clock', text: '1:00' });
    expect(waitParts(42.2)).toEqual({ kind: 'clock', text: '0:43' });
    expect(waitParts(5)).toEqual({ kind: 'clock', text: '0:05' });
    expect(waitParts(3599)).toEqual({ kind: 'clock', text: '59:59' });
    expect(waitParts(-3)).toEqual({ kind: 'clock', text: '0:00' });
  });

  it('says an hour or more in hours and minutes, rounded up to the minute (never 1319:54, H5 F4)', () => {
    expect(waitParts(3600)).toEqual({ kind: 'hours', hours: 1, minutes: 0 });
    expect(waitParts(3601)).toEqual({ kind: 'hours', hours: 1, minutes: 1 });
    expect(waitParts(1319 * 60 + 54)).toEqual({ kind: 'hours', hours: 22, minutes: 0 });
    expect(waitParts(80_999)).toEqual({ kind: 'hours', hours: 22, minutes: 30 });
  });
});
