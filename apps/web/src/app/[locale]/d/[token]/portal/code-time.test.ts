import { describe, expect, it } from 'vitest';
import { countdownText, waitUnit } from './code-time';

describe('the code panel\'s waits', () => {
  it('counts down M:SS, never below 0:00', () => {
    expect(countdownText(60)).toBe('1:00');
    expect(countdownText(42.2)).toBe('0:43');
    expect(countdownText(5)).toBe('0:05');
    expect(countdownText(-3)).toBe('0:00');
  });

  it('rounds a limit\'s wait up: minutes under two hours, else hours', () => {
    expect(waitUnit(1)).toEqual({ unit: 'minutes', count: 1 });
    expect(waitUnit(61)).toEqual({ unit: 'minutes', count: 2 });
    expect(waitUnit(119 * 60)).toEqual({ unit: 'minutes', count: 119 });
    expect(waitUnit(120 * 60)).toEqual({ unit: 'hours', count: 2 });
    expect(waitUnit(22.5 * 3600)).toEqual({ unit: 'hours', count: 23 });
  });
});
